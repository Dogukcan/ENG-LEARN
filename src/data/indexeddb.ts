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
//
// Sync rules (v4), the same everywhere in this file:
// - Every write sets `updatedAt`. It is always LATER than the value the record had before
//   (see `stampFrom`), so "last write wins" never loses a change made in the same millisecond.
// - Nothing is deleted for real. A delete sets `deletedAt` (a "soft delete") so the sync engine
//   can tell the server. Every read below ignores rows that have `deletedAt`.
// - A unique index must not block a new record because of a deleted one. Records with a
//   unique key (`normalized`, `youtubeKey`) therefore REMOVE that key field when they are soft
//   deleted. IndexedDB does not put a record into an index when the indexed field is missing,
//   so this works like the "partial unique index ... where deleted_at is null" in Postgres.

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import { addLocalDays, listLocalDays, localDayRange, toLocalDay, type LocalDay } from "./localDay";
import {
  createNewCardWith,
  getScheduler,
  gradeCardWith,
  recallProbabilityWith,
  type SchedulerOptions,
} from "./srs/scheduler";
import {
  DEFAULT_SETTINGS,
  NGSL_BANDS,
  SKILL_BLOCKS,
  applySettingsPatch,
  normalizeWord,
  type AddInboxResult,
  type AddVideoResult,
  type ApplyRemoteResult,
  type BookInput,
  type BookPosition,
  type CategoryWeeks,
  type Consistency,
  type DayMinutes,
  type DayRange,
  type MarkWatchedResult,
  type NewActivityLog,
  type NewInboxItem,
  type NewSpeakingSession,
  type NewVideo,
  type NgslBand,
  type Repository,
  type ReviewQueue,
  type ReviewQueueOptions,
  type ReviewResult,
  type ReviewSuccess,
  type SaveReportResult,
  type SettingsPatch,
  type SyncRow,
  type SyncStore,
  type TriageResult,
  type UndoResult,
  type UndoWatchedResult,
} from "./repository";
import { rankOf } from "./seed/ngsl";
import { parseRemoteRow } from "./syncSchemas";
import type {
  ActivityLog,
  Book,
  Card,
  InboxItem,
  ReviewGrade,
  ReviewLog,
  Settings,
  SkillBlock,
  SpeakingError,
  SpeakingReport,
  SpeakingSession,
  Video,
  VideoStatus,
  VideoUnderstanding,
  Word,
  WordStatus,
} from "./types";

/**
 * Bump this (and add a step in `upgrade`) whenever stores or indexes change.
 * Version 2 (Faz 2) adds the `cards` and `reviewLogs` stores. A bump is needed because
 * IndexedDB only lets code create stores inside an upgrade, and the upgrade only runs when the
 * requested version is higher than the one saved on the device. Existing data stays untouched.
 * Version 3 recomputes the stored `normalized` keys after normalizeWord learned about curly
 * apostrophes and repeated spaces.
 * Version 4 (sync) gives every record `updatedAt`, adds a `by-updatedAt` index to every store,
 * and adds the stores `videos`, `speakingSessions` and `speakingErrors`.
 * Version 5 gives the two seed books fixed ids and merges the old random-id copies into them.
 */
const DB_VERSION = 5;

/**
 * Version 3 upgrade step: recompute `normalized` for every stored record with the current
 * normalizeWord. The by-normalized index is unique, so two records that now fold to the same key
 * (for example "don't" and "don’t") would break the upgrade. Records already holding their
 * canonical key keep it first; then the rest go oldest first. A record whose new key is taken
 * keeps its old key, so nothing is deleted and no card loses its word. The old key contains a
 * curly apostrophe or a double space, which normalizeWord never produces, so it cannot clash
 * later. Each such case is reported with console.warn.
 */
async function recomputeNormalizedKeys(store: {
  getAll(): Promise<Array<{ id: string; word?: string; lemma?: string; normalized?: string; createdAt: string }>>;
  put(value: never): Promise<unknown>;
}): Promise<void> {
  const records = await store.getAll();
  const claimed = new Set<string>();
  const pending: typeof records = [];
  for (const record of records) {
    const canonical = normalizeWord(record.word ?? record.lemma ?? "");
    if (record.normalized === canonical) claimed.add(canonical);
    else pending.push(record);
  }
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const record of pending) {
    const canonical = normalizeWord(record.word ?? record.lemma ?? "");
    if (claimed.has(canonical)) {
      console.warn(
        `[eng-learn] db v3: "${record.id}" kept old key "${record.normalized}" because "${canonical}" belongs to an older record`,
      );
      continue;
    }
    claimed.add(canonical);
    await store.put({ ...record, normalized: canonical } as never);
  }
}

/** A record seen without its exact type: used by the upgrade backfill and by the sync code. */
type Loose = Record<string, unknown>;
interface LooseCursor {
  value: Loose;
  update(value: Loose): Promise<unknown>;
  continue(): Promise<LooseCursor | null>;
}
interface LooseStore {
  openCursor(): Promise<LooseCursor | null>;
  get(key: string): Promise<Loose | undefined>;
  put(value: Loose, key?: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  index(name: string): { get(key: string): Promise<Loose | undefined>; getAll(key: string): Promise<Loose[]> };
  getAll(): Promise<Loose[]>;
}

/**
 * Version 4 upgrade step: give every old record an `updatedAt`. The best honest guess is the
 * time the record was created or the event happened; records with no such time get `fallback`
 * (the upgrade time). Records that already have `updatedAt` (words) are left alone.
 * `patch` may change other fields of the same record in the same pass.
 */
async function backfillUpdatedAt(
  store: LooseStore,
  guessFrom: (record: Loose) => unknown,
  fallback: string,
  patch?: (record: Loose, updatedAt: string) => Loose,
): Promise<void> {
  let cursor = await store.openCursor();
  while (cursor) {
    const record = cursor.value;
    if (typeof record.updatedAt !== "string") {
      const guess = guessFrom(record);
      const updatedAt = typeof guess === "string" ? guess : fallback;
      const next = { ...record, updatedAt };
      await cursor.update(patch ? patch(next, updatedAt) : next);
    }
    cursor = await cursor.continue();
  }
}

/** Settings are a single record stored under this fixed key. */
const SETTINGS_KEY = "app";

// Stored records carry hidden helper fields (`normalized`, `youtubeKey`). They let an index find
// duplicates quickly. The public types stay clean: we strip them before returning. The field is
// missing on soft-deleted records on purpose (see the header of this file).
type StoredInboxItem = InboxItem & { normalized?: string };
type StoredWord = Word & { normalized?: string };
type StoredVideo = Video & { youtubeKey?: string };
// Settings are stored as a patch (so settings added later fall back to their defaults) plus the
// sync fields. The fixed id "app" is what the sync engine sees; this is a single-user app.
type StoredSettings = SettingsPatch & { id: string; updatedAt: string; deletedAt?: string };

interface EngLearnDB extends DBSchema {
  books: { key: string; value: Book; indexes: { "by-updatedAt": string } };
  inbox: {
    key: string;
    value: StoredInboxItem;
    indexes: { "by-normalized": string; "by-createdAt": string; "by-updatedAt": string };
  };
  words: {
    key: string;
    value: StoredWord;
    indexes: { "by-normalized": string; "by-status": WordStatus; "by-updatedAt": string };
  };
  activity: {
    key: string;
    value: ActivityLog;
    indexes: { "by-startedAt": string; "by-updatedAt": string };
  };
  cards: {
    key: string;
    value: Card;
    // by-wordId is unique: one card per word, enforced by the database itself.
    indexes: { "by-wordId": string; "by-due": string; "by-updatedAt": string };
  };
  reviewLogs: {
    key: string;
    value: ReviewLog;
    indexes: { "by-reviewedAt": string; "by-cardId": string; "by-updatedAt": string };
  };
  // Out-of-line key (no keyPath): the record is stored under SETTINGS_KEY.
  settings: { key: string; value: StoredSettings; indexes: { "by-updatedAt": string } };
  videos: {
    key: string;
    value: StoredVideo;
    // by-youtubeKey is unique: the same YouTube video cannot be in the list twice.
    indexes: { "by-youtubeKey": string; "by-status": VideoStatus; "by-updatedAt": string };
  };
  speakingSessions: {
    key: string;
    value: SpeakingSession;
    indexes: { "by-startedAt": string; "by-updatedAt": string };
  };
  speakingErrors: {
    key: string;
    value: SpeakingError;
    indexes: { "by-sessionId": string; "by-updatedAt": string };
  };
}

type Db = IDBPDatabase<EngLearnDB>;
type Tx = IDBPTransaction<EngLearnDB, StoreNames<EngLearnDB>[], "readwrite">;

/**
 * Fixed ids for the two paper books. Why fixed: every device used to invent its own random ids,
 * so two devices signing in to the same account pushed two "RW1" rows and the reader saw four
 * books. With one id per seed book, both devices write the same row and last write wins merges them.
 */
const SEED_BOOK_IDS: Record<string, string> = { RW1: "seed-rw1", RW2: "seed-rw2" };

/**
 * Seed rows are not a real edit, so they carry the oldest possible time. Why: they used to be
 * stamped "now", so a fresh second device pushed "unit 1, page 1" and the server accepted it as
 * the newest change, overwriting the real progress of the first device. At the epoch, last write
 * wins never prefers a seed row, and `listChangedSince` (strictly after the cursor) never lists it
 * for a push. The first real edit (setPosition/upsert) stamps a normal time.
 */
const SEED_UPDATED_AT = "1970-01-01T00:00:00.000Z";

function seedBooks(): Book[] {
  return [
    { id: SEED_BOOK_IDS.RW1, title: "Reader at Work 1", shortName: "RW1", unit: 1, page: 1, updatedAt: SEED_UPDATED_AT },
    { id: SEED_BOOK_IDS.RW2, title: "Reader at Work 2", shortName: "RW2", unit: 1, page: 1, updatedAt: SEED_UPDATED_AT },
  ];
}

/**
 * Collapse every live RW1 / RW2 copy that does not have the fixed seed id into the fixed row.
 * The copy with the newest `updatedAt` donates its title and position (the most recent reading
 * progress wins, the same rule as sync). The other copies become tombstones, and everything that
 * pointed to a copy (the active book setting, the book of an inbox item or word) is re-pointed to
 * the fixed id. Safe to run again: with no extra copies it writes nothing. It runs in the version 5
 * upgrade and again after books arrive from the server, because another device that has not
 * upgraded yet can still send its random-id copies.
 */
async function mergeSeedBookCopies(
  stores: { books: LooseStore; settings: LooseStore; inbox: LooseStore; words: LooseStore },
  now: Date,
): Promise<void> {
  const all = await stores.books.getAll();
  const isLiveRow = (book: Loose): boolean => typeof book.deletedAt !== "string";
  const idMap = new Map<string, string>();
  for (const [shortName, seedId] of Object.entries(SEED_BOOK_IDS)) {
    const named = all.filter((book) => book.shortName === shortName);
    const copies = named.filter((book) => book.id !== seedId && isLiveRow(book));
    if (copies.length === 0) continue;
    // References may point to old tombstoned copies too, so map those ids as well.
    for (const book of named) if (book.id !== seedId) idMap.set(book.id as string, seedId);

    const live = named.filter(isLiveRow);
    const donor = live.reduce((best, book) => ((book.updatedAt as string) > (best.updatedAt as string) ? book : best));
    // A merge is a real local change and must reach the server, so give it a fresh time; only
    // brand-new seed rows in seedBooks keep the epoch stamp. This can let a stale v4 copy
    // overwrite newer progress from another device, accepted because no v4 build was ever published.
    const newest = named.reduce((max, book) => ((book.updatedAt as string) > max ? (book.updatedAt as string) : max), "");
    await stores.books.put({
      id: seedId,
      title: donor.title,
      shortName,
      unit: donor.unit,
      page: donor.page,
      updatedAt: stampFrom(now, newest),
    });
    for (const copy of copies) {
      await stores.books.put(tombstone(copy as { updatedAt: string; deletedAt?: string }, now));
    }
  }
  if (idMap.size === 0) return;

  const settings = await stores.settings.get(SETTINGS_KEY);
  const activeId = settings?.activeBookId;
  if (settings && typeof activeId === "string" && idMap.has(activeId)) {
    await stores.settings.put(
      { ...settings, activeBookId: idMap.get(activeId), updatedAt: stampFrom(now, settings.updatedAt as string | undefined) },
      SETTINGS_KEY,
    );
  }
  for (const store of [stores.inbox, stores.words]) {
    for (const record of await store.getAll()) {
      const source = record.source as { kind?: string; bookId?: string } | undefined;
      if (source?.kind === "kitap" && typeof source.bookId === "string" && idMap.has(source.bookId)) {
        await store.put({
          ...record,
          source: { ...source, bookId: idMap.get(source.bookId) },
          updatedAt: stampFrom(now, record.updatedAt as string | undefined),
        });
      }
    }
  }
}

/** Keep every review when a twin card loses, and stamp the changed links for the next push. */
async function moveCardReviewLogs(logs: LooseStore, loserId: string, winnerId: string, now: Date): Promise<void> {
  for (const log of await logs.index("by-cardId").getAll(loserId)) {
    await logs.put({ ...log, cardId: winnerId, updatedAt: stampFrom(now, log.updatedAt as string) });
  }
}

/**
 * A local word was tombstoned because the server already has the same word under another id
 * (unique-twin adoption). Its card must not keep pointing to the dead word: the review queue
 * would never show it, and the learner would lose that word's schedule. Runs in the same
 * transaction as the word tombstone.
 *  - Surviving word has no live card: the dead word's card is re-pointed to the survivor. The
 *    card keeps its id, FSRS state and review logs.
 *  - Surviving word already has a live card: the card with more reps stays (a tie keeps the
 *    survivor's card) and the other is tombstoned. A word has exactly one card.
 */
async function moveCardAfterWordTwin(
  cards: LooseStore,
  reviewLogs: LooseStore,
  deadWordId: string,
  survivorWordId: string,
  now: Date,
): Promise<void> {
  const deadCard = await cards.index("by-wordId").get(deadWordId);
  if (!deadCard || !isLive(deadCard as { deletedAt?: string })) return;
  const survivorCard = await cards.index("by-wordId").get(survivorWordId);
  const survivorLive = survivorCard !== undefined && isLive(survivorCard as { deletedAt?: string });

  if (survivorLive && (survivorCard.reps as number) >= (deadCard.reps as number)) {
    await cards.put(tombstone(deadCard as { updatedAt: string }, now));
    await moveCardReviewLogs(reviewLogs, deadCard.id as string, survivorCard.id as string, now);
    return;
  }
  // by-wordId is unique even for soft-deleted cards, so the survivor's old record (a tombstone, or
  // a live card with fewer reps) is removed for real before the winner takes the word id.
  if (survivorCard) {
    await moveCardReviewLogs(reviewLogs, survivorCard.id as string, deadCard.id as string, now);
    await cards.delete(survivorCard.id as string);
  }
  await cards.put({
    ...deadCard,
    wordId: survivorWordId,
    updatedAt: stampFrom(now, deadCard.updatedAt as string),
  });
}

/** Trim optional text; blank text becomes "not given" (undefined). */
function cleanOptional(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Clean the "other spellings" list: trim, lower case, drop empties and repeats. Lower case
 * because `checkAnswer` compares in lower case anyway. Returns undefined when nothing is left,
 * so a word without alternatives stores no empty array.
 */
function cleanAlternatives(list: string[] | undefined): string[] | undefined {
  if (!list) return undefined;
  const cleaned = [...new Set(list.map(normalizeWord).filter((entry) => entry !== ""))];
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * The `updatedAt` for a write that happens at `now` to a record that had `previous` before.
 * Normally this is just `now`. If `previous` is the same or later (two writes in one
 * millisecond, or a clock that went back), it is one millisecond after `previous`, so the new
 * write is always strictly newer and sync can never mistake it for the old one.
 */
function stampFrom(now: Date, previous?: string): string {
  const time = now.getTime();
  const before = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(before) && before >= time ? before + 1 : time).toISOString();
}

function isLive<T extends { deletedAt?: string }>(record: T | undefined): record is T {
  return record !== undefined && record.deletedAt === undefined;
}

/**
 * Wrap a write method so listeners hear about it AFTER the method's promise resolved, which for
 * our methods means after the IndexedDB transaction committed. A listener that reloads data
 * therefore always sees the new state. A write that changed nothing (an `ok: false` result, or
 * `undefined` for "nothing found") does not notify. If the write throws, nobody is notified.
 */
function notifying<A extends unknown[], R>(
  notify: () => void,
  write: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const result = await write(...args);
    const changedNothing =
      result === undefined ||
      (typeof result === "object" && result !== null && "ok" in result && result.ok === false);
    if (!changedNothing) notify();
    return result;
  };
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
    updatedAt: stored.updatedAt,
  };
  if (stored.sentence !== undefined) item.sentence = stored.sentence;
  if (stored.meaningTr !== undefined) item.meaningTr = stored.meaningTr;
  if (stored.alternatives !== undefined) item.alternatives = stored.alternatives;
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

function toVideo(stored: StoredVideo): Video {
  const { youtubeKey: _hidden, ...video } = stored;
  return video;
}

/** The record as the sync engine sees it: no hidden helper fields. */
function toSyncRow(store: SyncStore, stored: Loose): SyncRow {
  const { normalized: _normalized, youtubeKey: _youtubeKey, ...row } = stored;
  if (store === "settings") {
    // The stored settings are a patch; sync always sends the complete settings.
    const full = applySettingsPatch(DEFAULT_SETTINGS, stored as SettingsPatch);
    return {
      ...full,
      id: SETTINGS_KEY,
      updatedAt: stored.updatedAt as string,
      ...(typeof stored.deletedAt === "string" ? { deletedAt: stored.deletedAt } : {}),
    };
  }
  return row as SyncRow;
}

/** Soft-delete a record that has a unique key field: stamp it and remove the key. */
function tombstone<T extends { updatedAt: string; deletedAt?: string }>(
  record: T,
  now: Date,
  keyField?: string,
): T {
  const stamp = stampFrom(now, record.updatedAt);
  const next: Record<string, unknown> = { ...record, updatedAt: stamp, deletedAt: stamp };
  if (keyField) delete next[keyField];
  return next as T;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a whole number >= 1, got ${value}`);
  }
}

/** The inclusive local-day range as the [start, end) UTC instants that cover it. */
function rangeBounds(range: DayRange): { start: string; end: string } {
  return { start: localDayRange(range.from).start, end: localDayRange(range.to).end };
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
        async upgrade(database, oldVersion, _newVersion, transaction) {
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
          if (oldVersion >= 1 && oldVersion < 3) {
            // Brand-new databases (0) start with keys computed by the current normalizeWord, so
            // only older data needs recomputing. No other awaits come before this, which keeps
            // the upgrade transaction alive.
            await recomputeNormalizedKeys(transaction.objectStore("inbox"));
            await recomputeNormalizedKeys(transaction.objectStore("words"));
          }
          if (oldVersion < 4) {
            // Sync (v4). First the new stores, then an updatedAt index on every store: the
            // sync engine asks "what changed since time T" and the index answers that fast.
            const videos = database.createObjectStore("videos", { keyPath: "id" });
            videos.createIndex("by-youtubeKey", "youtubeKey", { unique: true });
            videos.createIndex("by-status", "status");

            const sessions = database.createObjectStore("speakingSessions", { keyPath: "id" });
            sessions.createIndex("by-startedAt", "startedAt");

            const speakingErrors = database.createObjectStore("speakingErrors", { keyPath: "id" });
            speakingErrors.createIndex("by-sessionId", "sessionId");

            const storeNames = [
              "books",
              "inbox",
              "words",
              "activity",
              "cards",
              "reviewLogs",
              "settings",
              "videos",
              "speakingSessions",
              "speakingErrors",
            ] as const;
            for (const name of storeNames) {
              transaction.objectStore(name).createIndex("by-updatedAt", "updatedAt");
            }

            if (oldVersion >= 1) {
              // Old data: backfill updatedAt. A brand-new database (0) has only the seed books,
              // which already carry it. Only awaits on IndexedDB requests happen here.
              const now = new Date().toISOString();
              const loose = (name: (typeof storeNames)[number]) =>
                transaction.objectStore(name) as unknown as LooseStore;
              await backfillUpdatedAt(loose("books"), () => undefined, now);
              await backfillUpdatedAt(loose("inbox"), (r) => r.createdAt, now);
              await backfillUpdatedAt(loose("words"), (r) => r.createdAt, now);
              await backfillUpdatedAt(loose("activity"), (r) => r.startedAt, now);
              await backfillUpdatedAt(loose("cards"), (r) => r.createdAt, now);
              await backfillUpdatedAt(
                loose("reviewLogs"),
                (r) => r.reviewedAt,
                now,
                (record, updatedAt) => {
                  // The saved "card before the answer" is a Card too, so it needs the field.
                  const previous = record.previousCard as Loose | undefined;
                  if (previous && typeof previous.updatedAt !== "string") {
                    return { ...record, previousCard: { ...previous, updatedAt: previous.createdAt ?? updatedAt } };
                  }
                  return record;
                },
              );
              // The settings record gets the fixed sync id. It has no creation time, so: now.
              await backfillUpdatedAt(loose("settings"), () => undefined, now, (record) => ({
                ...record,
                id: SETTINGS_KEY,
              }));
            }
          }
          if (oldVersion >= 1 && oldVersion < 5) {
            // Version 5: old devices hold random-id seed books. A brand-new database (0) is
            // seeded with the fixed ids already. Only awaits on IndexedDB requests happen here.
            const loose = (name: "books" | "settings" | "inbox" | "words") =>
              transaction.objectStore(name) as unknown as LooseStore;
            await mergeSeedBookCopies(
              { books: loose("books"), settings: loose("settings"), inbox: loose("inbox"), words: loose("words") },
              new Date(),
            );
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
   * Run `work` in one readwrite transaction over `stores`. Either everything it wrote is saved or,
   * if it throws, nothing is. A failed request already aborts the transaction by itself; for any
   * other error (for example a RangeError from our own check) we abort explicitly, otherwise the
   * browser would still commit the writes made before the error. `tx.done` rejects after an abort;
   * we wait for it here so that second rejection is never "unhandled", and rethrow the ORIGINAL error.
   */
  async function inTransaction<R>(
    stores: StoreNames<EngLearnDB>[],
    work: (tx: Tx) => Promise<R>,
  ): Promise<R> {
    const tx = (await db()).transaction(stores, "readwrite");
    try {
      const result = await work(tx);
      await tx.done; // resolves only after the whole transaction is committed
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Already aborted or finished: nothing to undo.
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  /**
   * Shared by `add`, `restore` and the speaking report: write an inbox item unless its word is
   * already waiting in the inbox or is being learned. The check and the write happen in the
   * caller's transaction, so two quick taps cannot both pass the check and create two items.
   * A word that is already "known" or "ignored" is accepted and the item remembers the old
   * decision in `previousStatus`. Restoring the id of a soft-deleted item brings it back.
   */
  async function putInboxItemInTx(tx: Tx, item: InboxItem): Promise<AddInboxResult> {
    const normalized = normalizeWord(item.word);
    if (!normalized) return { ok: false, reason: "empty" };

    const inbox = tx.objectStore("inbox");
    // Soft-deleted records have no `normalized` field, so these two lookups see live rows only.
    const sameInInbox = await inbox.index("by-normalized").get(normalized);
    const sameInWords = await tx.objectStore("words").index("by-normalized").get(normalized);

    // Re-putting the very same item (same id) is allowed; that makes restore safe to repeat.
    if (sameInInbox && sameInInbox.id !== item.id) return { ok: false, reason: "duplicate" };
    if (sameInWords?.status === "learning") return { ok: false, reason: "already-learning" };

    const previousVersion = await inbox.get(item.id);
    const stored: InboxItem = { ...item, updatedAt: stampFrom(new Date(), previousVersion?.updatedAt) };
    delete stored.previousStatus;
    delete stored.deletedAt;
    if (sameInWords) stored.previousStatus = sameInWords.status as "known" | "ignored";
    await inbox.put({ ...stored, normalized });
    return { ok: true, item: stored };
  }

  /** Cards that are not soft-deleted and were created on the local day of `now`. */
  function countCreatedOnLocalDay(cards: Card[], now: Date): number {
    const { start, end } = localDayRange(toLocalDay(now));
    return cards.filter((card) => isLive(card) && card.createdAt >= start && card.createdAt < end).length;
  }

  /**
   * Sessions that started on a local day, oldest first. A plain function (not a method using
   * `this`) so it also works when a screen destructures it from `repository.activity`.
   */
  async function activityForDay(day: LocalDay): Promise<ActivityLog[]> {
    return activityInRange({ from: day, to: day });
  }

  /** Live activity that started inside the local-day range, oldest first. */
  async function activityInRange(range: DayRange): Promise<ActivityLog[]> {
    const { start, end } = rangeBounds(range);
    // [start, end): include local midnight, exclude the next local midnight.
    const keyRange = IDBKeyRange.bound(start, end, false, true);
    const logs = await (await db()).getAllFromIndex("activity", "by-startedAt", keyRange);
    return logs.filter(isLive);
  }

  async function readSettings(): Promise<Settings> {
    const stored = await (await db()).get("settings", SETTINGS_KEY);
    return applySettingsPatch(DEFAULT_SETTINGS, isLive(stored) ? stored : {});
  }

  async function errorsPerCategory(range: DayRange): Promise<Record<string, number>> {
    const { start, end } = rangeBounds(range);
    const database = await db();
    const sessions = await database.getAllFromIndex(
      "speakingSessions",
      "by-startedAt",
      IDBKeyRange.bound(start, end, false, true),
    );
    const counts: Record<string, number> = {};
    for (const session of sessions.filter(isLive)) {
      const errors = await database.getAllFromIndex("speakingErrors", "by-sessionId", session.id);
      for (const error of errors.filter(isLive)) {
        counts[error.category] = (counts[error.category] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Total minutes per local day for the range, every day present (zero when nothing happened). */
  async function minutesPerBlockPerDay(range: DayRange): Promise<DayMinutes[]> {
    const days = listLocalDays(range.from, range.to);
    const perDay = new Map<LocalDay, Record<SkillBlock, number>>();
    for (const day of days) perDay.set(day, { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 });
    if (days.length === 0) return [];
    for (const log of await activityInRange(range)) {
      const bucket = perDay.get(toLocalDay(new Date(log.startedAt)));
      if (bucket) bucket[log.block] += log.seconds;
    }
    // Sum seconds first and divide once, so many short sessions add up exactly.
    return days.map((day) => {
      const seconds = perDay.get(day) as Record<SkillBlock, number>;
      const minutes = { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 };
      for (const block of SKILL_BLOCKS) minutes[block] = seconds[block] / 60;
      return { day, minutes };
    });
  }

  // Screens subscribe here to learn "something was written, reload your data" (see react.ts).
  const listeners = new Set<() => void>();
  function notify(): void {
    // Copy first: a listener may unsubscribe itself while we loop. One broken listener must not
    // stop the others from hearing the news.
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("Repository listener failed", error);
      }
    }
  }

  const base: Omit<Repository, "subscribe"> = {
    books: {
      async list() {
        const books = await (await db()).getAll("books");
        return books.filter(isLive).sort((a, b) => a.shortName.localeCompare(b.shortName));
      },

      async get(id: string) {
        const book = await (await db()).get("books", id);
        return isLive(book) ? book : undefined;
      },

      async upsert(input: BookInput) {
        assertPositiveInteger("unit", input.unit);
        assertPositiveInteger("page", input.page);
        return inTransaction(["books"], async (tx) => {
          const id = input.id ?? crypto.randomUUID();
          const existing = input.id ? await tx.objectStore("books").get(id) : undefined;
          const book: Book = {
            id,
            title: input.title,
            shortName: input.shortName,
            unit: input.unit,
            page: input.page,
            updatedAt: stampFrom(new Date(), existing?.updatedAt),
          };
          await tx.objectStore("books").put(book);
          return book;
        });
      },

      async setPosition(id: string, position: BookPosition) {
        assertPositiveInteger("unit", position.unit);
        assertPositiveInteger("page", position.page);
        // Read and write in one transaction so a parallel edit cannot be lost in between.
        return inTransaction(["books"], async (tx) => {
          const existing = await tx.objectStore("books").get(id);
          if (!isLive(existing)) return undefined;
          const updated: Book = {
            ...existing,
            unit: position.unit,
            page: position.page,
            updatedAt: stampFrom(new Date(), existing.updatedAt),
          };
          await tx.objectStore("books").put(updated);
          return updated;
        });
      },
    },

    inbox: {
      async list() {
        // The index returns oldest first (ISO strings sort by time); reverse for newest first.
        const stored = await (await db()).getAllFromIndex("inbox", "by-createdAt");
        return stored.filter(isLive).reverse().map(toInboxItem);
      },

      async add(input: NewInboxItem) {
        const nowIso = new Date().toISOString();
        const item: InboxItem = {
          id: crypto.randomUUID(),
          word: input.word.trim(),
          source: input.source,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const sentence = cleanOptional(input.sentence);
        const meaningTr = cleanOptional(input.meaningTr);
        const alternatives = cleanAlternatives(input.alternatives);
        if (sentence !== undefined) item.sentence = sentence;
        if (meaningTr !== undefined) item.meaningTr = meaningTr;
        if (alternatives !== undefined) item.alternatives = alternatives;
        return inTransaction(["inbox", "words"], (tx) => putInboxItemInTx(tx, item));
      },

      async remove(id: string) {
        return inTransaction(["inbox"], async (tx) => {
          const existing = await tx.objectStore("inbox").get(id);
          if (!isLive(existing)) return undefined;
          // Soft delete: the row stays (marked) so the sync engine can tell the server.
          await tx.objectStore("inbox").put(tombstone(existing, new Date(), "normalized"));
          return toInboxItem(existing);
        });
      },

      async restore(item: InboxItem) {
        const clean = toInboxItem(item);
        return inTransaction(["inbox", "words"], (tx) => putInboxItemInTx(tx, clean));
      },
    },

    words: {
      async triage(inboxItemId: string, status: WordStatus, now = new Date()): Promise<TriageResult> {
        // The scheduler is awaited BEFORE the transaction opens: awaiting anything that is not an
        // IndexedDB request inside a transaction would let the browser close it early.
        const scheduler = await getScheduler(schedulerOptions);

        // Several stores change together, so all are in one readwrite transaction: either the
        // word is created, the card is created AND the inbox item is soft-deleted, or (on any
        // error) nothing changes.
        return inTransaction(["inbox", "words", "cards", "settings"], async (tx): Promise<TriageResult> => {
          const inbox = tx.objectStore("inbox");
          const item = await inbox.get(inboxItemId);
          if (!isLive(item)) return { ok: false, reason: "not-found" };

          const wordsStore = tx.objectStore("words");
          const cardsStore = tx.objectStore("cards");
          const nowIso = now.toISOString();
          const normalized = item.normalized ?? normalizeWord(item.word);

          // A re-captured word (previousStatus set) already has a Word record: update it
          // instead of creating a second one, which the unique "normalized" index would refuse.
          const existing = item.previousStatus
            ? await wordsStore.index("by-normalized").get(normalized)
            : undefined;

          const word: StoredWord = existing
            ? { ...existing, status, source: item.source, updatedAt: stampFrom(now, existing.updatedAt) }
            : {
                id: crypto.randomUUID(),
                lemma: item.word,
                normalized,
                status,
                source: item.source,
                createdAt: nowIso,
                updatedAt: nowIso,
              };
          if (item.meaningTr !== undefined) word.meaningTr = item.meaningTr;
          if (item.sentence !== undefined) word.sentence = item.sentence;
          if (item.alternatives !== undefined) word.alternatives = item.alternatives;

          if (status === "learning") {
            // Only "learning" words get a card, and a word keeps the card it already has.
            const oldCard = existing ? await cardsStore.index("by-wordId").get(existing.id) : undefined;
            if (oldCard) {
              // A card that another device deleted still sits in the unique by-wordId index, so
              // the word would end up "learning" with no card. Bring that card back instead.
              if (oldCard.deletedAt !== undefined) {
                const revived: Card = { ...oldCard, updatedAt: stampFrom(now, oldCard.updatedAt) };
                delete revived.deletedAt;
                await cardsStore.put(revived);
              }
            } else {
              // The daily limit protects the user from a review pile they cannot keep up with.
              const settingsRecord = await tx.objectStore("settings").get(SETTINGS_KEY);
              const settings = applySettingsPatch(DEFAULT_SETTINGS, isLive(settingsRecord) ? settingsRecord : {});
              const createdToday = countCreatedOnLocalDay(await cardsStore.getAll(), now);
              if (createdToday >= settings.newCardLimit) return { ok: false, reason: "new-card-limit" };
              await cardsStore.put(createNewCardWith(scheduler, word.id, now));
            }
          }

          await wordsStore.put(word);
          await inbox.put(tombstone(item, now, "normalized"));
          return { ok: true, word: toWord(word) };
        });
      },

      async listByStatus(status: WordStatus) {
        const stored = await (await db()).getAllFromIndex("words", "by-status", status);
        return stored
          .filter(isLive)
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
        // A card whose word is missing or deleted (for example after a twin adoption) can never be
        // shown. It must be dropped BEFORE the session cap and the counts, or it would take a slot
        // and inflate dueTotal / newToday.
        const liveWordIds = new Set(
          (await database.getAll("words")).filter(isLive).map((word) => word.id),
        );
        const due = (
          await database.getAllFromIndex("cards", "by-due", IDBKeyRange.upperBound(now.toISOString()))
        ).filter((card) => isLive(card) && liveWordIds.has(card.wordId));

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
          if (isLive(stored)) cards.push({ card, word: toWord(stored) });
        }

        const settings = await readSettings();
        return {
          cards,
          dueTotal: due.length,
          estimatedMinutes: (cards.length * secondsPerCard) / 60,
          newToday: countCreatedOnLocalDay(
            (await database.getAll("cards")).filter((card) => liveWordIds.has(card.wordId)),
            now,
          ),
          newLimit: settings.newCardLimit,
        };
      },

      async reviewCard(cardId: string, grade: ReviewGrade, now: Date): Promise<ReviewResult> {
        const scheduler = await getScheduler(schedulerOptions);
        // The card and its log are written together: a card must never move forward without
        // its log (undo and later parameter optimisation depend on the log).
        return inTransaction(["cards", "reviewLogs"], async (tx): Promise<ReviewResult> => {
          const previous = await tx.objectStore("cards").get(cardId);
          if (!isLive(previous)) return { ok: false, reason: "not-found" };
          const graded = gradeCardWith(scheduler, previous, grade, now);
          const card: Card = { ...graded.card, updatedAt: stampFrom(now, previous.updatedAt) };
          const log: ReviewLog = {
            id: crypto.randomUUID(),
            cardId,
            grade,
            reviewedAt: now.toISOString(),
            revlog: graded.revlog,
            previousCard: previous,
            updatedAt: now.toISOString(),
          };
          await tx.objectStore("cards").put(card);
          await tx.objectStore("reviewLogs").put(log);
          return { ok: true, card, log };
        });
      },

      async undoLastReview(): Promise<UndoResult> {
        return inTransaction(["cards", "reviewLogs"], async (tx): Promise<UndoResult> => {
          // Walk the time index backwards: the first live entry is the newest review. Logs that
          // were already undone are only marked deleted, so they are skipped here.
          let cursor = await tx.objectStore("reviewLogs").index("by-reviewedAt").openCursor(null, "prev");
          while (cursor && !isLive(cursor.value)) cursor = await cursor.continue();
          if (!cursor) return { ok: false, reason: "nothing-to-undo" };

          const log = cursor.value;
          const cards = tx.objectStore("cards");
          const current = await cards.get(log.cardId);
          // Twin adoption can move this log without changing its historical snapshot. Restoring
          // that snapshot would revive a losing card or put it back on the losing word.
          if (!isLive(current) || current.wordId !== log.previousCard.wordId || current.id !== log.previousCard.id) {
            return { ok: false, reason: "nothing-to-undo" };
          }
          // The snapshot restores everything, including lapses and the leech flag. Its updatedAt
          // must be newer than the card it replaces, or another device would ignore the undo.
          const restored: Card = {
            ...log.previousCard,
            updatedAt: stampFrom(new Date(), current?.updatedAt ?? log.previousCard.updatedAt),
          };
          delete restored.deletedAt;
          await cards.put(restored);
          await cursor.update(tombstone(log, new Date()));
          return { ok: true, card: restored };
        });
      },

      async listLeeches() {
        const database = await db();
        const result: Array<{ card: Card; word: Word }> = [];
        for (const card of await database.getAll("cards")) {
          if (!isLive(card) || !card.leech) continue;
          const stored = await database.get("words", card.wordId);
          if (isLive(stored)) result.push({ card, word: toWord(stored) });
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
          updatedAt: new Date().toISOString(),
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
        return inTransaction(["settings"], async (tx) => {
          const store = tx.objectStore("settings");
          const stored = await store.get(SETTINGS_KEY);
          const current = applySettingsPatch(DEFAULT_SETTINGS, isLive(stored) ? stored : {});
          const next = applySettingsPatch(current, patch);
          await store.put(
            { ...next, id: SETTINGS_KEY, updatedAt: stampFrom(new Date(), stored?.updatedAt) },
            SETTINGS_KEY,
          );
          return next;
        });
      },
    },

    videos: {
      async add(input: NewVideo): Promise<AddVideoResult> {
        const youtubeId = input.youtubeId.trim();
        if (youtubeId === "") throw new RangeError("youtubeId must not be blank");
        assertPositiveInteger("durationMinutes", input.durationMinutes);
        return inTransaction(["videos"], async (tx): Promise<AddVideoResult> => {
          const store = tx.objectStore("videos");
          // Soft-deleted videos have no youtubeKey, so this sees live videos only.
          if (await store.index("by-youtubeKey").get(youtubeId)) return { ok: false, reason: "duplicate" };
          const nowIso = new Date().toISOString();
          const video: Video = {
            id: crypto.randomUUID(),
            youtubeId,
            title: input.title.trim(),
            channel: input.channel.trim(),
            level: input.level,
            durationMinutes: input.durationMinutes,
            status: "todo",
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await store.put({ ...video, youtubeKey: youtubeId });
          return { ok: true, video };
        });
      },

      async listByStatus(status: VideoStatus) {
        const stored = (await (await db()).getAllFromIndex("videos", "by-status", status)).filter(isLive);
        const videos = stored.map(toVideo);
        return status === "todo"
          ? videos.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          : videos.sort((a, b) => (b.watchedAt ?? "").localeCompare(a.watchedAt ?? ""));
      },

      async markWatched(
        id: string,
        understanding?: VideoUnderstanding,
        now = new Date(),
      ): Promise<MarkWatchedResult> {
        // The video and its listening minutes change together, so a crash can never leave
        // "watched" without minutes (or minutes without "watched").
        return inTransaction(["videos", "activity"], async (tx): Promise<MarkWatchedResult> => {
          const videos = tx.objectStore("videos");
          const stored = await videos.get(id);
          if (!isLive(stored)) return { ok: false, reason: "not-found" };
          if (stored.status === "watched") return { ok: false, reason: "already-watched" };

          const nowIso = now.toISOString();
          const log: ActivityLog = {
            id: crypto.randomUUID(),
            block: "dinleme",
            startedAt: nowIso,
            seconds: stored.durationMinutes * 60,
            source: "manual",
            updatedAt: nowIso,
          };
          const next: StoredVideo = {
            ...stored,
            status: "watched",
            watchedAt: nowIso,
            activityId: log.id,
            updatedAt: stampFrom(now, stored.updatedAt),
          };
          if (understanding !== undefined) next.understanding = understanding;
          await tx.objectStore("activity").put(log);
          await videos.put(next);
          return { ok: true, video: toVideo(next) };
        });
      },

      async undoWatched(id: string): Promise<UndoWatchedResult> {
        return inTransaction(["videos", "activity"], async (tx): Promise<UndoWatchedResult> => {
          const videos = tx.objectStore("videos");
          const stored = await videos.get(id);
          if (!isLive(stored)) return { ok: false, reason: "not-found" };
          if (stored.status !== "watched") return { ok: false, reason: "not-watched" };

          // Remove exactly the minutes that markWatched logged.
          if (stored.activityId) {
            const activity = tx.objectStore("activity");
            const log = await activity.get(stored.activityId);
            if (isLive(log)) await activity.put(tombstone(log, new Date()));
          }
          const next: StoredVideo = {
            ...stored,
            status: "todo",
            updatedAt: stampFrom(new Date(), stored.updatedAt),
          };
          delete next.watchedAt;
          delete next.understanding;
          delete next.activityId;
          await videos.put(next);
          return { ok: true, video: toVideo(next) };
        });
      },

      async remove(id: string) {
        return inTransaction(["videos"], async (tx) => {
          const store = tx.objectStore("videos");
          const stored = await store.get(id);
          if (!isLive(stored)) return undefined;
          // Any minutes already logged for this video stay: that time really was spent.
          await store.put(tombstone(stored, new Date(), "youtubeKey"));
          return toVideo(stored);
        });
      },
    },

    speaking: {
      async saveReport(session: NewSpeakingSession, report: SpeakingReport): Promise<SaveReportResult> {
        // toISOString throws RangeError for an invalid date, before anything is written.
        const startedAt = new Date(session.startedAt).toISOString();
        return inTransaction(
          ["speakingSessions", "speakingErrors", "inbox", "words"],
          async (tx): Promise<SaveReportResult> => {
            const nowIso = new Date().toISOString();
            const saved: SpeakingSession = {
              id: crypto.randomUUID(),
              scenarioId: session.scenarioId,
              startedAt,
              rawReport: report,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            await tx.objectStore("speakingSessions").put(saved);

            for (const error of report.errors) {
              const row: SpeakingError = {
                id: crypto.randomUUID(),
                sessionId: saved.id,
                category: error.category,
                original: error.original,
                corrected: error.corrected,
                createdAt: nowIso,
                updatedAt: nowIso,
              };
              const note = cleanOptional(error.note);
              if (note !== undefined) row.note = note;
              await tx.objectStore("speakingErrors").put(row);
            }

            // New words go to the inbox like any captured word. A word that is blank, already
            // waiting, or already being learned is skipped; the same word twice in one report
            // is caught too, because the first one is already visible inside this transaction.
            let wordsAdded = 0;
            let wordsSkipped = 0;
            for (const entry of report.newWords) {
              const item: InboxItem = {
                id: crypto.randomUUID(),
                word: entry.word.trim(),
                source: { kind: "konusma" },
                createdAt: nowIso,
                updatedAt: nowIso,
              };
              const sentence = cleanOptional(entry.sentence);
              const meaningTr = cleanOptional(entry.meaningTr);
              if (sentence !== undefined) item.sentence = sentence;
              if (meaningTr !== undefined) item.meaningTr = meaningTr;
              const result = await putInboxItemInTx(tx, item);
              if (result.ok) wordsAdded += 1;
              else wordsSkipped += 1;
            }
            return { ok: true, session: saved, errorsSaved: report.errors.length, wordsAdded, wordsSkipped };
          },
        );
      },

      errorsPerCategory,

      async listErrors(sessionId: string) {
        const rows = await (await db()).getAllFromIndex("speakingErrors", "by-sessionId", sessionId);
        return rows.filter(isLive);
      },
    },

    stats: {
      minutesPerBlockPerDay,

      async consistency(today: LocalDay = toLocalDay()): Promise<Consistency> {
        const settings = await readSettings();
        const days = await minutesPerBlockPerDay({ from: addLocalDays(today, -29), to: today });
        const reached = days.map(
          (entry) => SKILL_BLOCKS.reduce((sum, block) => sum + entry.minutes[block], 0) >= settings.dailyMinimumMinutes,
        );
        const count = (flags: boolean[]) => flags.filter(Boolean).length;
        return { last7: count(reached.slice(-7)), last30: count(reached) };
      },

      async totalListeningMinutes() {
        let seconds = 0;
        for (const log of await (await db()).getAll("activity")) {
          if (isLive(log) && log.block === "dinleme") seconds += log.seconds;
        }
        // Sum seconds first and round down once, like the Dinleme screen does.
        return Math.floor(seconds / 60);
      },

      async wordCounts() {
        const counts: Record<WordStatus, number> = { learning: 0, known: 0, ignored: 0 };
        for (const word of await (await db()).getAll("words")) {
          if (isLive(word)) counts[word.status] += 1;
        }
        return counts;
      },

      async knownWordsPerNgslBand() {
        const counts: Record<NgslBand, number> = {} as Record<NgslBand, number>;
        for (const band of NGSL_BANDS) counts[band] = 0;
        for (const word of await (await db()).getAllFromIndex("words", "by-status", "known")) {
          if (!isLive(word)) continue;
          const rank = rankOf(word.lemma);
          const band: NgslBand =
            rank === null ? "listede yok" : rank <= 1000 ? "1-1000" : rank <= 2000 ? "1001-2000" : "2001-2809";
          counts[band] += 1;
        }
        return counts;
      },

      async reviewSuccessRate(today: LocalDay = toLocalDay()): Promise<ReviewSuccess> {
        const { start, end } = rangeBounds({ from: addLocalDays(today, -6), to: today });
        const logs = await (await db()).getAllFromIndex(
          "reviewLogs",
          "by-reviewedAt",
          IDBKeyRange.bound(start, end, false, true),
        );
        const live = logs.filter(isLive);
        const good = live.filter((log) => log.grade === "good").length;
        return { good, total: live.length, rate: live.length === 0 ? null : good / live.length };
      },

      async leechCount() {
        return (await base.cards.listLeeches()).length;
      },

      async speakingErrorsWeekOverWeek(today: LocalDay = toLocalDay()) {
        const thisWeek = await errorsPerCategory({ from: addLocalDays(today, -6), to: today });
        const lastWeek = await errorsPerCategory({ from: addLocalDays(today, -13), to: addLocalDays(today, -7) });
        const result: Record<string, CategoryWeeks> = {};
        for (const category of new Set([...Object.keys(thisWeek), ...Object.keys(lastWeek)])) {
          result[category] = { thisWeek: thisWeek[category] ?? 0, lastWeek: lastWeek[category] ?? 0 };
        }
        return result;
      },
    },

    sync: {
      async listChangedSince(store: SyncStore, isoTime: string): Promise<SyncRow[]> {
        const database = await db();
        if (store === "settings") {
          // One record under a fixed key; it has no useful range to query.
          const stored = await database.get("settings", SETTINGS_KEY);
          return stored && stored.updatedAt > isoTime ? [toSyncRow("settings", stored)] : [];
        }
        // The index is sorted by updatedAt, so this is a range query: strictly after isoTime.
        const rows = await (database as unknown as {
          getAllFromIndex(store: string, index: string, range: IDBKeyRange): Promise<Loose[]>;
        }).getAllFromIndex(store, "by-updatedAt", IDBKeyRange.lowerBound(isoTime, true));
        return rows.map((row) => toSyncRow(store, row));
      },

      async applyRemote(store: SyncStore, rows: unknown[]): Promise<ApplyRemoteResult> {
        const result: ApplyRemoteResult = { applied: 0, skipped: 0, conflicts: 0, invalid: 0 };
        const incoming: Loose[] = [];
        for (const row of rows) {
          const parsed = parseRemoteRow(store, row);
          if (parsed) incoming.push(parsed);
          else result.invalid += 1;
        }
        if (incoming.length === 0) return result;

        // Which hidden unique key does this store have, and which public field feeds it?
        const uniqueKey =
          store === "inbox" ? { field: "normalized", index: "by-normalized", from: "word" }
          : store === "words" ? { field: "normalized", index: "by-normalized", from: "lemma" }
          : store === "videos" ? { field: "youtubeKey", index: "by-youtubeKey", from: "youtubeId" }
          : undefined;

        // A twin's card and review links move atomically with the conflict resolution.
        const stores: StoreNames<EngLearnDB>[] = store === "words" ? ["words", "cards", "reviewLogs"]
          : store === "cards" ? ["cards", "reviewLogs"] : [store];
        await inTransaction(stores, async (tx) => {
          const os = tx.objectStore(store) as unknown as LooseStore;
          const now = new Date();
          for (const row of incoming) {
            const key = store === "settings" ? SETTINGS_KEY : (row.id as string);
            const local = await os.get(key);
            // Last write wins. Equal times keep the local copy: it is already the same change.
            if (local && (local.updatedAt as string) >= (row.updatedAt as string)) {
              result.skipped += 1;
              continue;
            }

            const stored: Loose = store === "settings" ? { ...row, id: SETTINGS_KEY } : { ...row };
            const deleted = typeof row.deletedAt === "string";

            if (uniqueKey && !deleted) {
              const text = row[uniqueKey.from] as string;
              // youtube ids are case-sensitive; words are compared in their normalised form.
              const value = uniqueKey.field === "normalized" ? normalizeWord(text) : text.trim();
              if (value === "") {
                result.invalid += 1;
                continue;
              }
              const other = await os.index(uniqueKey.index).get(value);
              if (other && other.id !== row.id) {
                result.conflicts += 1;
                if ((other.updatedAt as string) >= (row.updatedAt as string)) {
                  result.skipped += 1;
                  continue;
                }
                // The remote row is newer: the local twin loses. Free its unique key first.
                await os.put(tombstone(other as { updatedAt: string }, now, uniqueKey.field));
                if (store === "words") {
                  await moveCardAfterWordTwin(
                    tx.objectStore("cards") as unknown as LooseStore,
                    tx.objectStore("reviewLogs") as unknown as LooseStore,
                    other.id as string,
                    row.id as string,
                    now,
                  );
                }
              }
              stored[uniqueKey.field] = value;
            }

            if (store === "cards") {
              // by-wordId is a plain unique index (soft-deleted cards keep their wordId), so a
              // card for the same word under another id must be dealt with before the put.
              const other = await os.index("by-wordId").get(row.wordId as string);
              if (other && other.id !== row.id) {
                result.conflicts += 1;
                const otherWins = isLive(other as { deletedAt?: string }) && (other.updatedAt as string) >= (row.updatedAt as string);
                if (deleted || otherWins) {
                  result.skipped += 1;
                  continue;
                }
                // The other card is an old tombstone or older than the remote card. A word has
                // one card, so the stale record is removed for real.
                await moveCardReviewLogs(
                  tx.objectStore("reviewLogs") as unknown as LooseStore,
                  other.id as string,
                  row.id as string,
                  now,
                );
                await os.delete(other.id as string);
              }
            }

            await os.put(stored, store === "settings" ? SETTINGS_KEY : undefined);
            result.applied += 1;
          }
        });
        if (store === "books" && result.applied > 0) {
          // A device that has not upgraded yet may still send random-id RW1/RW2 copies.
          await inTransaction(["books", "settings", "inbox", "words"], async (tx) => {
            const loose = (name: "books" | "settings" | "inbox" | "words") =>
              tx.objectStore(name) as unknown as LooseStore;
            await mergeSeedBookCopies(
              { books: loose("books"), settings: loose("settings"), inbox: loose("inbox"), words: loose("words") },
              new Date(),
            );
          });
        }
        return result;
      },

      async clearLocalData(): Promise<void> {
        const names = [
          "books", "inbox", "words", "activity", "cards", "reviewLogs",
          "settings", "videos", "speakingSessions", "speakingErrors",
        ] as const;
        await inTransaction([...names], async (tx) => {
          for (const name of names) await tx.objectStore(name).clear();
          // The app cannot work without its two books, so they come back (fresh, fixed ids).
          for (const book of seedBooks()) await tx.objectStore("books").put(book);
        });
      },
    },
  };

  const wrap = <A extends unknown[], R>(write: (...args: A) => Promise<R>) =>
    notifying(notify, write);

  return {
    books: {
      ...base.books,
      upsert: wrap(base.books.upsert),
      setPosition: wrap(base.books.setPosition),
    },
    inbox: {
      ...base.inbox,
      add: wrap(base.inbox.add),
      remove: wrap(base.inbox.remove),
      restore: wrap(base.inbox.restore),
    },
    words: { ...base.words, triage: wrap(base.words.triage) },
    cards: {
      ...base.cards,
      reviewCard: wrap(base.cards.reviewCard),
      undoLastReview: wrap(base.cards.undoLastReview),
    },
    activity: { ...base.activity, add: wrap(base.activity.add) },
    settings: { ...base.settings, update: wrap(base.settings.update) },
    videos: {
      ...base.videos,
      add: wrap(base.videos.add),
      markWatched: wrap(base.videos.markWatched),
      undoWatched: wrap(base.videos.undoWatched),
      remove: wrap(base.videos.remove),
    },
    speaking: { ...base.speaking, saveReport: wrap(base.speaking.saveReport) },
    stats: base.stats,
    sync: {
      ...base.sync,
      // Remote rows change what screens show, so they hear about it, but only if a row was written.
      async applyRemote(store, rows) {
        const result = await base.sync.applyRemote(store, rows);
        if (result.applied > 0) notify();
        return result;
      },
      async clearLocalData() {
        await base.sync.clearLocalData();
        notify();
      },
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
