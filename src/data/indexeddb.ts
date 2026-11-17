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
import { localDayRange, toLocalDay, type LocalDay } from "./localDay";
import {
  createNewCardWith,
  getScheduler,
  gradeCardWith,
  recallProbabilityWith,
  type SchedulerOptions,
} from "./srs/scheduler";
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
  type ReviewQueue,
  type ReviewQueueOptions,
  type ReviewResult,
  type UndoResult,
  type SettingsPatch,
  type TriageResult,
} from "./repository";
import type {
  ActivityLog,
  Book,
  Card,
  InboxItem,
  ReviewGrade,
  ReviewLog,
  Settings,
  SkillBlock,
  Word,
  WordStatus,
} from "./types";

/**
 * Bump this (and add a step in `upgrade`) whenever stores or indexes change.
 * Version 2 (Faz 2) adds the `cards` and `reviewLogs` stores. A bump is needed because
 * IndexedDB only lets code create stores inside an upgrade, and the upgrade only runs when the
 * requested version is higher than the one saved on the device. Existing data stays untouched.
 */
const DB_VERSION = 2;

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
  cards: {
    key: string;
    value: Card;
    // by-wordId is unique: one card per word, enforced by the database itself.
    indexes: { "by-wordId": string; "by-due": string };
  };
  reviewLogs: {
    key: string;
    value: ReviewLog;
    indexes: { "by-reviewedAt": string; "by-cardId": string };
  };
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
  if (stored.previousStatus !== undefined) item.previousStatus = stored.previousStatus;
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
  if (stored.alternatives !== undefined) word.alternatives = stored.alternatives;
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
export function createIndexedDbRepository(
  dbName = "eng-learn",
  schedulerOptions: SchedulerOptions = {},
): Repository {
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
            words.createIndex("by-normalized", "normalized", { unique: true });
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
          if (oldVersion < 2) {
            // Faz 2: spaced repetition. Runs for brand-new databases (0 -> 2) and for devices
            // that still have version 1 data (1 -> 2); the v1 stores are not touched.
            const cards = database.createObjectStore("cards", { keyPath: "id" });
            cards.createIndex("by-wordId", "wordId", { unique: true });
            // dueAt is an ISO string, so the index sorts by time and "due now" is a range query.
            cards.createIndex("by-due", "dueAt");

            const reviewLogs = database.createObjectStore("reviewLogs", { keyPath: "id" });
            reviewLogs.createIndex("by-reviewedAt", "reviewedAt");
            reviewLogs.createIndex("by-cardId", "cardId");
          }
        },
        // If another tab or the home-screen app opens a newer DB version in a future phase,
        // close our older connection and drop the cached promise so the upgrade is not blocked.
        blocking() {
          const currentPromise = dbPromise;
          dbPromise = undefined;
          void currentPromise?.then((database) => database.close());
        },
        // If the browser abnormally closes the connection, forget the cached promise so the
        // next call reopens the database cleanly.
        terminated() {
          dbPromise = undefined;
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
   * Shared by `add` and `restore`: write an inbox item unless its word is already waiting in
   * the inbox or is being learned. The check and the write happen in ONE transaction, so two
   * quick taps cannot both pass the check and create two items.
   * A word that is already "known" or "ignored" is accepted and the item remembers the old
   * decision in `previousStatus`.
   */
  async function putInboxItemIfNew(item: InboxItem): Promise<AddInboxResult> {
    const normalized = normalizeWord(item.word);
    if (!normalized) return { ok: false, reason: "empty" };

    const tx = (await db()).transaction(["inbox", "words"], "readwrite");
    try {
      const inbox = tx.objectStore("inbox");
      const sameInInbox = await inbox.index("by-normalized").get(normalized);
      const sameInWords = await tx.objectStore("words").index("by-normalized").get(normalized);

      // Re-putting the very same item (same id) is allowed; that makes restore safe to repeat.
      if (sameInInbox && sameInInbox.id !== item.id) {
        await tx.done;
        return { ok: false, reason: "duplicate" };
      }
      if (sameInWords?.status === "learning") {
        await tx.done;
        return { ok: false, reason: "already-learning" };
      }

      const stored: InboxItem = { ...item };
      delete stored.previousStatus;
      if (sameInWords) stored.previousStatus = sameInWords.status as "known" | "ignored";
      await inbox.put({ ...stored, normalized });
      await tx.done;
      return { ok: true, item: stored };
    } catch (error) {
      // A failed request aborts the transaction and makes `tx.done` reject as well. Await it
      // here so that second rejection is not "unhandled", then rethrow the original error.
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  /**
   * How many of these cards were created on the local day of `now`. The cards store is small
   * (a few thousand at most), so reading it all is simpler than keeping a createdAt index.
   */
  function countCreatedOnLocalDay(cards: Card[], now: Date): number {
    const { start, end } = localDayRange(toLocalDay(now));
    return cards.filter((card) => card.createdAt >= start && card.createdAt < end).length;
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

  async function readSettings(): Promise<Settings> {
    const stored = await (await db()).get("settings", SETTINGS_KEY);
    return applySettingsPatch(DEFAULT_SETTINGS, stored ?? {});
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
      async triage(inboxItemId: string, status: WordStatus, now = new Date()): Promise<TriageResult> {
        // The scheduler is awaited BEFORE the transaction opens: awaiting anything that is not an
        // IndexedDB request inside a transaction would let the browser close it early.
        const scheduler = await getScheduler(schedulerOptions);

        // Several stores change together, so all are in one readwrite transaction: either the
        // word is created, the card is created AND the inbox item is deleted, or (on any error)
        // nothing changes.
        const tx = (await db()).transaction(["inbox", "words", "cards", "settings"], "readwrite");
        try {
          const inbox = tx.objectStore("inbox");
          const item = await inbox.get(inboxItemId);
          if (!item) {
            await tx.done;
            return { ok: false, reason: "not-found" };
          }

          const wordsStore = tx.objectStore("words");
          const cardsStore = tx.objectStore("cards");
          const nowIso = now.toISOString();

          // A re-captured word (previousStatus set) already has a Word record: update it
          // instead of creating a second one, which the unique "normalized" index would refuse.
          const existing = item.previousStatus
            ? await wordsStore.index("by-normalized").get(item.normalized)
            : undefined;

          const word: StoredWord = existing
            ? { ...existing, status, source: item.source, updatedAt: nowIso }
            : {
                id: crypto.randomUUID(),
                lemma: item.word,
                normalized: item.normalized,
                status,
                source: item.source,
                createdAt: nowIso,
                updatedAt: nowIso,
              };
          if (item.meaningTr !== undefined) word.meaningTr = item.meaningTr;
          if (item.sentence !== undefined) word.sentence = item.sentence;

          if (status === "learning") {
            // Only "learning" words get a card, and a word keeps the card it already has.
            const hasCard = existing
              ? (await cardsStore.index("by-wordId").count(existing.id)) > 0
              : false;
            if (!hasCard) {
              // The daily limit protects the user from a review pile they cannot keep up with.
              const settings = applySettingsPatch(
                DEFAULT_SETTINGS,
                (await tx.objectStore("settings").get(SETTINGS_KEY)) ?? {},
              );
              const createdToday = countCreatedOnLocalDay(await cardsStore.getAll(), now);
              if (createdToday >= settings.newCardLimit) {
                await tx.done;
                return { ok: false, reason: "new-card-limit" };
              }
              await cardsStore.put(createNewCardWith(scheduler, word.id, now));
            }
          }

          await wordsStore.put(word);
          await inbox.delete(inboxItemId);
          await tx.done; // resolves only after the whole transaction is committed
          return { ok: true, word: toWord(word) };
        } catch (error) {
          // A failed request aborts the transaction (nothing is written). `tx.done` then rejects
          // too; if nobody awaits it, that is an unhandled rejection. Await it here, ignore only
          // that secondary rejection, and rethrow the original error so it is never hidden.
          await tx.done.catch(() => undefined);
          throw error;
        }
      },

      async listByStatus(status: WordStatus) {
        const stored = await (await db()).getAllFromIndex("words", "by-status", status);
        return stored
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(toWord);
      },
    },

    cards: {
      async getReviewQueue(now: Date, options: ReviewQueueOptions = {}): Promise<ReviewQueue> {
        const { maxMinutes = 15, secondsPerCard = 20 } = options;
        const scheduler = await getScheduler(schedulerOptions);
        const database = await db();

        // by-due holds ISO strings, so "due <= now" is a range query ending at now.
        const due = await database.getAllFromIndex(
          "cards",
          "by-due",
          IDBKeyRange.upperBound(now.toISOString()),
        );

        // Sort by the chance of recalling the word, lowest first. A card at 60% is much closer
        // to being forgotten than one at 89%, so limited session time goes to the first one.
        // Sorting by due date alone would treat a stable card that is one day late the same as
        // a fragile card that is one day late.
        const ranked = due
          .map((card) => ({ card, probability: recallProbabilityWith(scheduler, card, now) }))
          .sort((a, b) => a.probability - b.probability);

        // Cap the session so it fits the time budget (at least 1 card if anything is due).
        const maxCards = Math.max(1, Math.floor((maxMinutes * 60) / secondsPerCard));
        const chosen = ranked.slice(0, maxCards);

        const cards: ReviewQueue["cards"] = [];
        for (const { card } of chosen) {
          const stored = await database.get("words", card.wordId);
          if (stored) cards.push({ card, word: toWord(stored) });
        }

        const settings = await readSettings();
        return {
          cards,
          dueTotal: due.length,
          estimatedMinutes: (cards.length * secondsPerCard) / 60,
          newToday: countCreatedOnLocalDay(await database.getAll("cards"), now),
          newLimit: settings.newCardLimit,
        };
      },

      async reviewCard(cardId: string, grade: ReviewGrade, now: Date): Promise<ReviewResult> {
        const scheduler = await getScheduler(schedulerOptions);
        // The card and its log are written together: a card must never move forward without
        // its log (undo and later parameter optimisation depend on the log).
        const tx = (await db()).transaction(["cards", "reviewLogs"], "readwrite");
        try {
          const previous = await tx.objectStore("cards").get(cardId);
          if (!previous) {
            await tx.done;
            return { ok: false, reason: "not-found" };
          }
          const { card, revlog } = gradeCardWith(scheduler, previous, grade, now);
          const log: ReviewLog = {
            id: crypto.randomUUID(),
            cardId,
            grade,
            reviewedAt: now.toISOString(),
            revlog,
            previousCard: previous,
          };
          await tx.objectStore("cards").put(card);
          await tx.objectStore("reviewLogs").put(log);
          await tx.done;
          return { ok: true, card, log };
        } catch (error) {
          await tx.done.catch(() => undefined);
          throw error;
        }
      },

      async undoLastReview(): Promise<UndoResult> {
        const tx = (await db()).transaction(["cards", "reviewLogs"], "readwrite");
        try {
          // Walk the time index backwards: the first entry is the newest review.
          const cursor = await tx
            .objectStore("reviewLogs")
            .index("by-reviewedAt")
            .openCursor(null, "prev");
          if (!cursor) {
            await tx.done;
            return { ok: false, reason: "nothing-to-undo" };
          }
          const log = cursor.value;
          // The snapshot restores everything, including lapses and the leech flag.
          await tx.objectStore("cards").put(log.previousCard);
          await cursor.delete();
          await tx.done;
          return { ok: true, card: log.previousCard };
        } catch (error) {
          await tx.done.catch(() => undefined);
          throw error;
        }
      },

      async listLeeches() {
        const database = await db();
        const result: Array<{ card: Card; word: Word }> = [];
        for (const card of await database.getAll("cards")) {
          if (!card.leech) continue;
          const stored = await database.get("words", card.wordId);
          if (stored) result.push({ card, word: toWord(stored) });
        }
        return result;
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
        return readSettings();
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
