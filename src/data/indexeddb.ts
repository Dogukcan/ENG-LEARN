// IndexedDB implementation of the Repository (Faz 1: data stays in the browser, works offline).
//
// We use the small `idb` library instead of raw IndexedDB. Raw IndexedDB uses event callbacks;
// `idb` wraps the same API in Promises so we can write `await store.get(id)`. The `DBSchema`
// type below also lets TypeScript check store names, keys and index names.
//
// Key IndexedDB ideas used here:
// - Object store: like a table. Each record has a primary key (`keyPath: "id"`).
// - Index: a second sorted lookup on a field (e.g. inbox items by createdAt).
// - Transaction: a group of reads and writes that succeed or fail together.
//   Important rule: do not await anything that is not an IndexedDB request inside a
//   transaction (no fetch, no timers), or the transaction closes early.
// - Version + upgrade: the database has a version number. When the code asks for a higher
//   version than the one on the device, `upgrade` runs once to create or change stores.
//   This is the only place where the structure may change.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { localDayRange, type LocalDay } from "./localDay";
import {
  DEFAULT_SETTINGS,
  SKILL_BLOCKS,
  applySettingsPatch,
  normalizeWord,
  type AddInboxResult,
  type BookInput,
  type BookPosition,
  type NewActivityLog,
  type NewInboxItem,
  type Repository,
  type SettingsPatch,
  type TriageResult,
} from "./repository";
import type { ActivityLog, Book, InboxItem, Settings, SkillBlock, Word, WordStatus } from "./types";

/** Bump this (and add a step in `upgrade`) whenever stores or indexes change. */
const DB_VERSION = 1;

/** Settings are a single record stored under this fixed key. */
const SETTINGS_KEY = "app";

// Stored records carry one extra hidden field, `normalized` (see normalizeWord). It lets an
// index find duplicates quickly. The public types stay clean: we strip it before returning.
type StoredInboxItem = InboxItem & { normalized: string };
type StoredWord = Word & { normalized: string };

interface EngLearnDB extends DBSchema {
  books: { key: string; value: Book };
  inbox: {
    key: string;
    value: StoredInboxItem;
    indexes: { "by-normalized": string; "by-createdAt": string };
  };
  words: {
    key: string;
    value: StoredWord;
    indexes: { "by-normalized": string; "by-status": WordStatus };
  };
  activity: { key: string; value: ActivityLog; indexes: { "by-startedAt": string } };
  // Out-of-line key (no keyPath): the record is stored under SETTINGS_KEY.
  // Stored as a patch so settings added in later versions fall back to their defaults.
  settings: { key: string; value: SettingsPatch };
}

type Db = IDBPDatabase<EngLearnDB>;

function seedBooks(): Book[] {
  return [
    { id: crypto.randomUUID(), title: "Reader at Work 1", shortName: "RW1", unit: 1, page: 1 },
    { id: crypto.randomUUID(), title: "Reader at Work 2", shortName: "RW2", unit: 1, page: 1 },
  ];
}

/** Trim optional text; blank text becomes "not given" (undefined). */
function cleanOptional(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Copy only the public InboxItem fields. Used to strip the hidden `normalized` field on the way
 * out, and to ignore any unknown extra fields a caller might pass to `restore`.
 */
function toInboxItem(stored: InboxItem): InboxItem {
  const item: InboxItem = {
    id: stored.id,
    word: stored.word,
    source: stored.source,
    createdAt: stored.createdAt,
  };
  if (stored.sentence !== undefined) item.sentence = stored.sentence;
  if (stored.meaningTr !== undefined) item.meaningTr = stored.meaningTr;
  return item;
}

function toWord(stored: StoredWord): Word {
  const word: Word = {
    id: stored.id,
    lemma: stored.lemma,
    status: stored.status,
    source: stored.source,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
  if (stored.meaningTr !== undefined) word.meaningTr = stored.meaningTr;
  if (stored.sentence !== undefined) word.sentence = stored.sentence;
  return word;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a whole number >= 1, got ${value}`);
  }
}

/**
 * Create a Repository backed by IndexedDB.
 * The database opens lazily on first use, so creating the repository is cheap and safe at
 * import time. Tests pass a unique `dbName` so every test starts with an empty database.
 */
export function createIndexedDbRepository(dbName = "eng-learn"): Repository {
  let dbPromise: Promise<Db> | undefined;

  function db(): Promise<Db> {
    if (!dbPromise) {
      dbPromise = openDB<EngLearnDB>(dbName, DB_VERSION, {
        upgrade(database, oldVersion, _newVersion, transaction) {
          // oldVersion is 0 when the database is brand new on this device.
          if (oldVersion < 1) {
            database.createObjectStore("books", { keyPath: "id" });

            const inbox = database.createObjectStore("inbox", { keyPath: "id" });
            // unique: the database itself refuses a second inbox item with the same word.
            inbox.createIndex("by-normalized", "normalized", { unique: true });
            inbox.createIndex("by-createdAt", "createdAt");

            const words = database.createObjectStore("words", { keyPath: "id" });
            words.createIndex("by-normalized", "normalized");
            words.createIndex("by-status", "status");

            const activity = database.createObjectStore("activity", { keyPath: "id" });
            activity.createIndex("by-startedAt", "startedAt");

            database.createObjectStore("settings");

            // Seed only on first creation. The writes join the upgrade transaction, so the
            // database is never visible without its books.
            const books = transaction.objectStore("books");
            for (const book of seedBooks()) {
              void books.put(book);
            }
          }
          // Future example: if (oldVersion < 2) { ...add a new store or index... }
        },
      }).catch((error: unknown) => {
        // Forget the failed attempt so the next call can try again.
        dbPromise = undefined;
        throw error;
      });
    }
    return dbPromise;
  }

  /**
   * Shared by `add` and `restore`: write an inbox item unless its word already exists.
   * The check and the write happen in ONE transaction, so two quick taps cannot both pass the
   * check and create two items.
   */
  async function putInboxItemIfNew(item: InboxItem): Promise<AddInboxResult> {
    const normalized = normalizeWord(item.word);
    if (!normalized) return { ok: false, reason: "empty" };

    const tx = (await db()).transaction(["inbox", "words"], "readwrite");
    const inbox = tx.objectStore("inbox");
    const sameInInbox = await inbox.index("by-normalized").get(normalized);
    const sameInWords = await tx.objectStore("words").index("by-normalized").count(normalized);

    // Re-putting the very same item (same id) is allowed; that makes restore safe to repeat.
    if ((sameInInbox && sameInInbox.id !== item.id) || sameInWords > 0) {
      await tx.done;
      return { ok: false, reason: "duplicate" };
    }
    await inbox.put({ ...item, normalized });
    await tx.done;
    return { ok: true, item };
  }

  /**
   * Sessions that started on a local day, oldest first. A plain function (not a method using
   * `this`) so it also works when a screen destructures it from `repository.activity`.
   */
  async function activityForDay(day: LocalDay): Promise<ActivityLog[]> {
    const { start, end } = localDayRange(day);
    // [start, end): include local midnight, exclude the next local midnight.
    const range = IDBKeyRange.bound(start, end, false, true);
    return (await db()).getAllFromIndex("activity", "by-startedAt", range);
  }

  return {
    books: {
      async list() {
        const books = await (await db()).getAll("books");
        return books.sort((a, b) => a.shortName.localeCompare(b.shortName));
      },

      async get(id: string) {
        return (await db()).get("books", id);
      },

      async upsert(input: BookInput) {
        assertPositiveInteger("unit", input.unit);
        assertPositiveInteger("page", input.page);
        const book: Book = {
          id: input.id ?? crypto.randomUUID(),
          title: input.title,
          shortName: input.shortName,
          unit: input.unit,
          page: input.page,
        };
        await (await db()).put("books", book);
        return book;
      },

      async setPosition(id: string, position: BookPosition) {
        assertPositiveInteger("unit", position.unit);
        assertPositiveInteger("page", position.page);
        // Read and write in one transaction so a parallel edit cannot be lost in between.
        const tx = (await db()).transaction("books", "readwrite");
        const existing = await tx.store.get(id);
        if (!existing) {
          await tx.done;
          return undefined;
        }
        const updated: Book = { ...existing, unit: position.unit, page: position.page };
        await tx.store.put(updated);
        await tx.done;
        return updated;
      },
    },

    inbox: {
      async list() {
        // The index returns oldest first (ISO strings sort by time); reverse for newest first.
        const stored = await (await db()).getAllFromIndex("inbox", "by-createdAt");
        return stored.reverse().map(toInboxItem);
      },

      async add(input: NewInboxItem) {
        const item: InboxItem = {
          id: crypto.randomUUID(),
          word: input.word.trim(),
          source: input.source,
          createdAt: new Date().toISOString(),
        };
        const sentence = cleanOptional(input.sentence);
        const meaningTr = cleanOptional(input.meaningTr);
        if (sentence !== undefined) item.sentence = sentence;
        if (meaningTr !== undefined) item.meaningTr = meaningTr;
        return putInboxItemIfNew(item);
      },

      async remove(id: string) {
        const tx = (await db()).transaction("inbox", "readwrite");
        const existing = await tx.store.get(id);
        if (existing) await tx.store.delete(id);
        await tx.done;
        return existing ? toInboxItem(existing) : undefined;
      },

      async restore(item: InboxItem) {
        return putInboxItemIfNew(toInboxItem(item));
      },
    },

    words: {
      async triage(inboxItemId: string, status: WordStatus): Promise<TriageResult> {
        // Two stores change together, so both are in one readwrite transaction: either the
        // word is created AND the inbox item is deleted, or (on any error) nothing changes.
        const tx = (await db()).transaction(["inbox", "words"], "readwrite");
        const inbox = tx.objectStore("inbox");
        const item = await inbox.get(inboxItemId);
        if (!item) {
          await tx.done;
          return { ok: false, reason: "not-found" };
        }

        const now = new Date().toISOString();
        const word: Word = {
          id: crypto.randomUUID(),
          lemma: item.word,
          status,
          source: item.source,
          createdAt: now,
          updatedAt: now,
        };
        if (item.meaningTr !== undefined) word.meaningTr = item.meaningTr;
        if (item.sentence !== undefined) word.sentence = item.sentence;

        await tx.objectStore("words").put({ ...word, normalized: item.normalized });
        await inbox.delete(inboxItemId);
        await tx.done; // resolves only after the whole transaction is committed
        return { ok: true, word };
      },

      async listByStatus(status: WordStatus) {
        const stored = await (await db()).getAllFromIndex("words", "by-status", status);
        return stored
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(toWord);
      },
    },

    activity: {
      async add(input: NewActivityLog) {
        if (!Number.isFinite(input.seconds) || input.seconds < 0) {
          throw new RangeError(`seconds must be a finite number >= 0, got ${input.seconds}`);
        }
        const log: ActivityLog = {
          id: crypto.randomUUID(),
          block: input.block,
          // Normalise to the UTC ISO form so day range queries compare like with like.
          // toISOString throws RangeError for an invalid date.
          startedAt: new Date(input.startedAt).toISOString(),
          seconds: Math.round(input.seconds),
          source: input.source,
        };
        await (await db()).put("activity", log);
        return log;
      },

      listForDay: activityForDay,

      async minutesPerBlockForDay(day: LocalDay) {
        const logs = await activityForDay(day);
        // Start every block at 0 so the UI never has to handle a missing block.
        const minutes: Record<SkillBlock, number> = { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 };
        for (const log of logs) minutes[log.block] += log.seconds;
        // Sum seconds first and divide once, so many short sessions add up exactly.
        for (const block of SKILL_BLOCKS) minutes[block] = minutes[block] / 60;
        return minutes;
      },
    },

    settings: {
      async get(): Promise<Settings> {
        const stored = await (await db()).get("settings", SETTINGS_KEY);
        return applySettingsPatch(DEFAULT_SETTINGS, stored ?? {});
      },

      async update(patch: SettingsPatch): Promise<Settings> {
        const tx = (await db()).transaction("settings", "readwrite");
        const stored = await tx.store.get(SETTINGS_KEY);
        const current = applySettingsPatch(DEFAULT_SETTINGS, stored ?? {});
        const next = applySettingsPatch(current, patch);
        await tx.store.put(next, SETTINGS_KEY);
        await tx.done;
        return next;
      },
    },
  };
}
