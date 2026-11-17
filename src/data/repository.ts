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
  InboxItem,
  Settings,
  SkillBlock,
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
export type BookInput = Omit<Book, "id"> & { id?: string };

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
  source: CaptureSource;
}

/**
 * Result of adding (or restoring) an inbox item.
 * - "empty": the word was blank after trimming spaces.
 * - "duplicate": the same word (ignoring case and outer spaces) is already in the inbox or
 *   in the word list, so the user does not sort the same word twice.
 */
export type AddInboxResult =
  | { ok: true; item: InboxItem }
  | { ok: false; reason: "duplicate" | "empty" };

/** Result of triage. "not-found" means the inbox item no longer exists (e.g. already sorted). */
export type TriageResult = { ok: true; word: Word } | { ok: false; reason: "not-found" };

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

// ---------- The interface ----------

export interface Repository {
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
     */
    triage(inboxItemId: string, status: WordStatus): Promise<TriageResult>;
    /** Words with the given status, newest first. */
    listByStatus(status: WordStatus): Promise<Word[]>;
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
}

// ---------- Small pure helpers shared by every implementation ----------

/** The duplicate-check key for a word: outer spaces removed, lower case. */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
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
