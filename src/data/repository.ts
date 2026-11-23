// The Repository interface: the only door between screens and stored data.
//
// Why an interface? Screens should not care WHERE data lives. In Faz 1 it lives in the
// browser (IndexedDB, see indexeddb.ts). In Faz 4 a Supabase implementation will replace it.
// Because every screen talks only to this interface, swapping the storage means writing one new
// file that implements `Repository`, with zero screen changes.
//
// Why are all methods async (return a Promise)? IndexedDB is asynchronous, and a network
// database is too. Making every method async now means callers never need to change later.
//
// Expected problems (an empty word, a duplicate) are returned as typed results instead of thrown
// errors, so TypeScript forces the screen to handle them. Programming mistakes (a negative
// duration, a malformed day string) still throw.

import type { LocalDay } from "./localDay";
import type {
  ActivityLog,
  ActivitySource,
  Book,
  CaptureSource,
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
  VideoLevel,
  VideoStatus,
  VideoUnderstanding,
  Word,
  WordStatus,
} from "./types";

/** All skill blocks in display order. Handy for loops and for zero-filled totals. */
export const SKILL_BLOCKS: readonly SkillBlock[] = ["okuma", "kelime", "dinleme", "konusma"];

/** Settings used when the user has not changed anything yet. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  dailyMinimumMinutes: 20,
  dailyTargetMinutes: 95,
  blockPlanMinutes: { okuma: 35, kelime: 15, dinleme: 25, konusma: 20 },
  newCardLimit: 10,
  activeBookId: null,
};

// ---------- Input and result types ----------

/** A book to create or replace. Leave out `id` to create a new book with a fresh id. */
export type BookInput = Omit<Book, "id" | "updatedAt" | "deletedAt"> & { id?: string };

/** Where the user is in a book. Both numbers are 1-based whole numbers. */
export interface BookPosition {
  unit: number;
  page: number;
}

/** What the capture form sends. Only `word` and `source` are required. */
export interface NewInboxItem {
  word: string;
  sentence?: string;
  meaningTr?: string;
  /** Other accepted spellings, e.g. ["harbour"]. Cleaned (trimmed, lower case) on add. */
  alternatives?: string[];
  source: CaptureSource;
}

/**
 * Result of adding (or restoring) an inbox item.
 * - "empty": the word was blank after trimming spaces.
 * - "duplicate": the same word (ignoring case and outer spaces) is already in the inbox, so
 *   the user does not sort the same word twice.
 * - "already-learning": the word is already being learned (it has a review card).
 * A word the user earlier sorted as "known" or "ignored" is allowed again: the new inbox item
 * carries `previousStatus`, because meeting a "known" word again may mean it is not known.
 */
export type AddInboxResult =
  | { ok: true; item: InboxItem }
  | { ok: false; reason: "duplicate" | "empty" | "already-learning" };

/**
 * Result of triage.
 * - "not-found": the inbox item no longer exists (e.g. already sorted).
 * - "new-card-limit": choosing "learn" would pass `settings.newCardLimit` new cards for today.
 *   Nothing was changed; the inbox item is still there.
 */
export type TriageResult =
  | { ok: true; word: Word }
  | { ok: false; reason: "not-found" | "new-card-limit" };

/** Time budget for one review session. */
export interface ReviewQueueOptions {
  /** Session length cap in minutes. Default 15. */
  maxMinutes?: number;
  /** Estimated answer time per card in seconds. Default 20. */
  secondsPerCard?: number;
}

export interface ReviewQueue {
  /** Cards to review now, lowest recall probability first. */
  cards: Array<{ card: Card; word: Word }>;
  /** All cards that are due, also those that did not fit into the time budget. */
  dueTotal: number;
  /** Estimated time for the `cards` list, in minutes. The value is fractional on purpose (cards times seconds per card, divided by 60); screens must not round it themselves but call `reviewMinutes()` from `src/features/bugun/todayLogic.ts`, which shows whole minutes with a minimum of 1. */
  estimatedMinutes: number;
  /** Cards created today (local day). */
  newToday: number;
  /** The daily new card limit from the settings. */
  newLimit: number;
}

export type ReviewResult =
  | { ok: true; card: Card; log: ReviewLog }
  | { ok: false; reason: "not-found" };

/** Result of undo: the restored card, or "nothing-to-undo" when the log is empty. */
export type UndoResult =
  | { ok: true; card: Card }
  | { ok: false; reason: "nothing-to-undo" };

/** A practice session to record. The repository creates the id. */
export interface NewActivityLog {
  block: SkillBlock;
  /** Any string `new Date()` understands; it is stored as a UTC ISO string. */
  startedAt: string;
  /** Length in seconds (rounded to whole seconds, must not be negative). */
  seconds: number;
  source: ActivitySource;
}

/** A partial settings change. Block plan minutes can be changed one block at a time. */
export type SettingsPatch = Partial<Omit<Settings, "blockPlanMinutes">> & {
  blockPlanMinutes?: Partial<Record<SkillBlock, number>>;
};

/** What the video form sends. The repository sets the id, status and dates. */
export interface NewVideo {
  youtubeId: string;
  title: string;
  channel: string;
  level: VideoLevel;
  /** Whole minutes, at least 1. */
  durationMinutes: number;
}

/** "duplicate": a live video with the same YouTube id is already in the list. */
export type AddVideoResult =
  | { ok: true; video: Video }
  | { ok: false; reason: "duplicate" };

export type MarkWatchedResult =
  | { ok: true; video: Video }
  | { ok: false; reason: "not-found" | "already-watched" };

export type UndoWatchedResult =
  | { ok: true; video: Video }
  | { ok: false; reason: "not-found" | "not-watched" };

/** The start of a speaking session, as the screen knows it. */
export interface NewSpeakingSession {
  scenarioId: string;
  /** Any string `new Date()` understands; stored as a UTC ISO string. */
  startedAt: string;
}

/** What `saveReport` did. New words that were already known to the app are counted as skipped. */
export interface SaveReportResult {
  ok: true;
  session: SpeakingSession;
  errorsSaved: number;
  wordsAdded: number;
  wordsSkipped: number;
}

/** An inclusive range of local days, e.g. { from: "2026-11-11", to: "2026-11-17" }. */
export interface DayRange {
  from: LocalDay;
  to: LocalDay;
}

// ---------- Statistics results ----------

export interface DayMinutes {
  day: LocalDay;
  minutes: Record<SkillBlock, number>;
}

/** Days that reached the daily minimum (settings.dailyMinimumMinutes), out of 7 and out of 30. */
export interface Consistency {
  last7: number;
  last30: number;
}

/** NGSL frequency bands. "listede yok" = not on the NGSL list at all. */
export type NgslBand = "1-1000" | "1001-2000" | "2001-2809" | "listede yok";
export const NGSL_BANDS: readonly NgslBand[] = ["1-1000", "1001-2000", "2001-2809", "listede yok"];

export interface ReviewSuccess {
  good: number;
  total: number;
  /** good / total, or null when there were no reviews (so the UI shows "-", not "0%"). */
  rate: number | null;
}

export interface CategoryWeeks {
  thisWeek: number;
  lastWeek: number;
}

// ---------- Sync (used by the sync engine, not by screens) ----------

/** Every store that is synced. The names are the IndexedDB store names. */
export const SYNC_STORES = [
  "books",
  "inbox",
  "words",
  "cards",
  "reviewLogs",
  "activity",
  "settings",
  "videos",
  "speakingSessions",
  "speakingErrors",
] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

/**
 * A record as the sync engine sees it: the public fields plus `updatedAt` and `deletedAt`.
 * Hidden storage helper fields (like the duplicate-check key) are never included.
 * The settings row has the fixed id "app" (this is a single-user app).
 */
export interface SyncRow {
  id: string;
  updatedAt: string;
  deletedAt?: string;
  [field: string]: unknown;
}

/**
 * What `applyRemote` did with the rows it received.
 * - applied: written locally.
 * - skipped: the local copy was as new or newer (last write wins), or the row was an old tombstone.
 * - conflicts: a different record already owns the same unique key (same word, same video, same
 *   card word); the newer one won. A conflict is also counted in `applied` or `skipped`.
 * - invalid: the row did not have the shape of that store, so it was ignored.
 */
export interface ApplyRemoteResult {
  applied: number;
  skipped: number;
  conflicts: number;
  invalid: number;
}

// ---------- The interface ----------

export interface Repository {
  /**
   * Call `listener` after any write finished (add, triage, review, undo, settings...). Returns
   * a function that stops the listening. Screens use it to reload when data changes anywhere.
   */
  subscribe(listener: () => void): () => void;
  books: {
    /** All books, sorted by short name (RW1, RW2, ...). */
    list(): Promise<Book[]>;
    get(id: string): Promise<Book | undefined>;
    /** Create or replace a book. Returns the stored book (with its id). */
    upsert(book: BookInput): Promise<Book>;
    /** Move the bookmark. Returns the updated book, or undefined if the id is unknown. */
    setPosition(id: string, position: BookPosition): Promise<Book | undefined>;
  };
  inbox: {
    /** Captured words waiting for triage, newest first. */
    list(): Promise<InboxItem[]>;
    /** Capture a word. Rejects blank words and duplicates (see AddInboxResult). */
    add(input: NewInboxItem): Promise<AddInboxResult>;
    /** Delete an item. Returns the removed item so the UI can offer "undo" via `restore`. */
    remove(id: string): Promise<InboxItem | undefined>;
    /** Put a removed item back exactly as it was (same id and createdAt). */
    restore(item: InboxItem): Promise<AddInboxResult>;
  };
  words: {
    /**
     * Sort an inbox item: create a Word with the given status and delete the inbox item,
     * both in one transaction, so a crash can never leave the word in both places or in neither.
     * Choosing "learning" also creates the review card in the same transaction, unless today's
     * new card limit is reached (then nothing changes). If the item was captured again
     * (`previousStatus`), the existing Word is updated instead of creating a second one.
     * `now` is a parameter so tests and callers can control the clock (default: the real time).
     */
    triage(inboxItemId: string, status: WordStatus, now?: Date): Promise<TriageResult>;
    /** Words with the given status, newest first. */
    listByStatus(status: WordStatus): Promise<Word[]>;
  };
  cards: {
    /**
     * Cards that are due at `now`, the ones most likely forgotten first, cut to fit the time
     * budget (default 15 minutes at 20 seconds per card).
     */
    getReviewQueue(now: Date, options?: ReviewQueueOptions): Promise<ReviewQueue>;
    /** Record an answer: new card state and a ReviewLog are written in one transaction. */
    reviewCard(cardId: string, grade: ReviewGrade, now: Date): Promise<ReviewResult>;
    /** Take back the most recent review: restores the card and deletes that log entry. */
    undoLastReview(): Promise<UndoResult>;
    /** Cards flagged as leeches (forgotten 5 times), with their words. */
    listLeeches(): Promise<Array<{ card: Card; word: Word }>>;
  };
  activity: {
    add(input: NewActivityLog): Promise<ActivityLog>;
    /** Sessions that started on the given local day (device time zone), oldest first. */
    listForDay(day: LocalDay): Promise<ActivityLog[]>;
    /** Minutes per block on the given local day; blocks without activity are 0. Not rounded. */
    minutesPerBlockForDay(day: LocalDay): Promise<Record<SkillBlock, number>>;
  };
  settings: {
    /** Stored settings merged over DEFAULT_SETTINGS, so new fields always have a value. */
    get(): Promise<Settings>;
    /** Change some settings and return the full result. */
    update(patch: SettingsPatch): Promise<Settings>;
  };
  videos: {
    /** Add a video to the list. A live video with the same YouTube id is a typed failure. */
    add(input: NewVideo): Promise<AddVideoResult>;
    /**
     * Videos with the given status. "todo": oldest first (a queue). "watched": most recently
     * watched first.
     */
    listByStatus(status: VideoStatus): Promise<Video[]>;
    /**
     * Mark a video as watched and, in the SAME transaction, log its minutes as "dinleme"
     * activity (source "manual"), so the video and the minutes can never disagree.
     */
    markWatched(id: string, understanding?: VideoUnderstanding, now?: Date): Promise<MarkWatchedResult>;
    /** Take back `markWatched`: the video is "todo" again and its activity log is removed. */
    undoWatched(id: string): Promise<UndoWatchedResult>;
    /** Remove a video from the list. Returns it, or undefined if the id is unknown. */
    remove(id: string): Promise<Video | undefined>;
  };
  speaking: {
    /**
     * Store a finished session and its errors in one transaction, and add the report's new words
     * to the inbox with source `{ kind: "konusma" }`. Words that are blank, already in the inbox
     * or already being learned are skipped (counted in `wordsSkipped`).
     */
    saveReport(session: NewSpeakingSession, report: SpeakingReport): Promise<SaveReportResult>;
    /** Errors of sessions that started inside the range, counted per category. */
    errorsPerCategory(range: DayRange): Promise<Record<string, number>>;
    /** The errors of one session (no promised order). */
    listErrors(sessionId: string): Promise<SpeakingError[]>;
  };
  /** Read-only numbers for the İstatistik screen. `today` is a parameter so tests control the clock. */
  stats: {
    /** Minutes per block for every local day in the range (days without activity are all zero). */
    minutesPerBlockPerDay(range: DayRange): Promise<DayMinutes[]>;
    /** How many of the last 7 and last 30 local days (today included) reached the daily minimum. */
    consistency(today?: LocalDay): Promise<Consistency>;
    /** All "dinleme" minutes ever logged, rounded down to whole minutes (same rule as the Dinleme screen). */
    totalListeningMinutes(): Promise<number>;
    /** How many words have each status. */
    wordCounts(): Promise<Record<WordStatus, number>>;
    /** Known words per NGSL band, using the NGSL rank of the lemma. */
    knownWordsPerNgslBand(): Promise<Record<NgslBand, number>>;
    /** Share of "good" answers in the last 7 local days (today included). */
    reviewSuccessRate(today?: LocalDay): Promise<ReviewSuccess>;
    /** Number of leech cards. */
    leechCount(): Promise<number>;
    /** Speaking errors per category: the last 7 local days versus the 7 days before. */
    speakingErrorsWeekOverWeek(today?: LocalDay): Promise<Record<string, CategoryWeeks>>;
  };
  /** The sync engine's door. It does not notify subscribers when it only READS. */
  sync: {
    /** Rows of a store whose `updatedAt` is after `isoTime`, deleted rows included, oldest first. */
    listChangedSince(store: SyncStore, isoTime: string): Promise<SyncRow[]>;
    /**
     * Merge rows received from the server. Last write wins on `updatedAt`: a remote row replaces
     * the local one only when it is strictly newer. Remote `updatedAt` values are kept as they
     * are (they are not bumped), so applying remote rows never creates a "local change" to push
     * back. Unique keys (word, video, card per word) are respected: see `ApplyRemoteResult`.
     */
    applyRemote(store: SyncStore, rows: unknown[]): Promise<ApplyRemoteResult>;
    /**
     * Delete EVERY local record (all stores, tombstones included) and put the two fixed seed
     * books back. For "another account signed in on this device" and "delete this device's
     * data". It does not touch the sync cursors; the caller resets them. Notifies subscribers.
     */
    clearLocalData(): Promise<void>;
  };
}

// ---------- Small pure helpers shared by every implementation ----------

/**
 * The duplicate-check key for a word: lower case, outer spaces removed, runs of spaces collapsed
 * and curly apostrophes folded to a plain one. Text copied from books or typed on a phone with
 * smart punctuation uses the curly form, so without this "don't" and "don’t" would be two words.
 * Changing this changes stored keys: the database version 3 upgrade recomputes them.
 */
export function normalizeWord(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Apply a settings patch on top of a base. Written field by field on purpose: a plain
 * `{ ...base, ...patch }` would let `{ dailyTargetMinutes: undefined }` erase a value, and it
 * would replace the whole block plan when only one block changed.
 */
export function applySettingsPatch(base: Readonly<Settings>, patch: SettingsPatch): Settings {
  const plan = patch.blockPlanMinutes;
  return {
    dailyMinimumMinutes: patch.dailyMinimumMinutes ?? base.dailyMinimumMinutes,
    dailyTargetMinutes: patch.dailyTargetMinutes ?? base.dailyTargetMinutes,
    blockPlanMinutes: {
      okuma: plan?.okuma ?? base.blockPlanMinutes.okuma,
      kelime: plan?.kelime ?? base.blockPlanMinutes.kelime,
      dinleme: plan?.dinleme ?? base.blockPlanMinutes.dinleme,
      konusma: plan?.konusma ?? base.blockPlanMinutes.konusma,
    },
    newCardLimit: patch.newCardLimit ?? base.newCardLimit,
    // `null` is a real value here ("no active book"), so only `undefined` means "unchanged".
    activeBookId: patch.activeBookId !== undefined ? patch.activeBookId : base.activeBookId,
  };
}
