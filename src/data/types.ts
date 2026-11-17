// Plain data types for ENG-LEARN.
//
// Why plain types (no classes)? These objects travel through many places: React state,
// IndexedDB today, Supabase (JSON over the network) in Faz 4. Plain objects survive all of
// those unchanged, while class instances lose their methods when they are stored and read back.
//
// Conventions used everywhere in this layer:
// - Ids are strings made by `crypto.randomUUID()`. They are created on the device, so a record
//   has its final id even while offline, and the ids never clash when data is synced later.
// - Dates are stored as ISO strings in UTC (`new Date().toISOString()`, e.g.
//   "2026-11-17T07:30:00.000Z"). These strings sort in time order, which lets IndexedDB use
//   them as index keys for range queries ("everything that started today").
// - FSRS (spaced repetition) data lives in `Card` and `ReviewLog` below, added in Faz 2.

/** The four daily skill blocks. Turkish names because they are the user's own words in the UI. */
export type SkillBlock = "okuma" | "kelime" | "dinleme" | "konusma";

/** A paper book the user reads. The app never stores the book text, only where the user is. */
export interface Book {
  id: string;
  title: string;
  /** Short label for small spaces in the UI, e.g. "RW1". */
  shortName: string;
  /** Current unit (1-based). */
  unit: number;
  /** Current page (1-based). */
  page: number;
}

/**
 * Where a captured word came from ("Nereden?" in the UI).
 * This is a discriminated union: the `kind` field tells TypeScript which other fields exist,
 * so a "kitap" source always has a bookId and page, and a "video" source never does.
 */
export type CaptureSource =
  | { kind: "kitap"; bookId: string; page: number }
  | { kind: "video"; label?: string }
  | { kind: "konusma" }
  | { kind: "diger" };

/** A word that was captured quickly and is waiting to be sorted (triaged) later. */
export interface InboxItem {
  id: string;
  /** The word exactly as the user typed it, with outer spaces removed. */
  word: string;
  /** Optional example sentence, often pasted from iPhone Live Text. */
  sentence?: string;
  /** Optional Turkish meaning. */
  meaningTr?: string;
  source: CaptureSource;
  createdAt: string;
  /**
   * Set when this word was captured again after the user had already sorted it as "known" or
   * "ignored". It remembers the old decision so the triage screen can say "you marked this as
   * known before" and so the existing Word is updated instead of duplicated.
   */
  previousStatus?: "known" | "ignored";
}

/** What the user decided about a word during triage. */
export type WordStatus = "learning" | "known" | "ignored";

/** A sorted word. Only "learning" words get a review card (see `Card`). */
export interface Word {
  id: string;
  lemma: string;
  status: WordStatus;
  meaningTr?: string;
  sentence?: string;
  /** Other accepted spellings when typing the answer, e.g. "harbour" for "harbor". */
  alternatives?: string[];
  source: CaptureSource;
  createdAt: string;
  updatedAt: string;
}

/** How a block of practice time was recorded. */
export type ActivitySource = "timer" | "manual";

/** One stretch of practice time in one skill block. */
export interface ActivityLog {
  id: string;
  block: SkillBlock;
  /** When the practice started (ISO string, UTC). Decides which local day it belongs to. */
  startedAt: string;
  /** Length in whole seconds. Seconds (not minutes) so short timer sessions are not lost. */
  seconds: number;
  source: ActivitySource;
}

/** User preferences. Defaults live in `DEFAULT_SETTINGS` (repository.ts). */
export interface Settings {
  /** The "good enough" day: reaching this never feels like failure. Default 20. */
  dailyMinimumMinutes: number;
  /** The full plan for a day. Default 95 (= the sum of the block plan). */
  dailyTargetMinutes: number;
  /** Planned minutes per block. Default okuma 35, kelime 15, dinleme 25, konusma 20. */
  blockPlanMinutes: Record<SkillBlock, number>;
  /** How many new words may become cards per day (used from Faz 2). Default 10. */
  newCardLimit: number;
  /** The book shown on the Okuma screen; null until the user picks one. */
  activeBookId: string | null;
}

// ---------- Spaced repetition (Faz 2) ----------

/**
 * ts-fsrs memory phase of a card: 0 = New (never reviewed), 1 = Learning (short steps like
 * 1 and 10 minutes), 2 = Review (long intervals), 3 = Relearning (forgotten, short steps again).
 * Same numbers as the `State` enum in ts-fsrs, but written here so this file stays plain types.
 */
export type CardState = 0 | 1 | 2 | 3;

/** Coarser phase name that ts-fsrs 6 also stores on every card. */
export type CardScheduleStatus = "new" | "learning" | "review";

/**
 * A review card: one per word. It holds the FSRS "memory state" for that word.
 *
 * The three numbers that describe memory:
 * - `stability`: how many days the memory lasts. Precisely: the number of days after which the
 *   chance of recalling the word falls from 100% to 90%. Bigger = the word is well learned.
 * - `stabilityFast`: FSRS-7 keeps a second, short-term stability for what happens within a day
 *   or so. It matters right after the first reviews.
 * - `difficulty`: how hard this word is for this user (about 1 to 10). Hard words grow their
 *   stability more slowly after each success.
 *
 * Dates are ISO strings at rest (UTC). They are converted to `Date` right before ts-fsrs is called.
 */
export interface Card {
  /** Same value as ts-fsrs `cardId`, so the review log entries point to the same id. */
  id: string;
  wordId: string;
  stability: number;
  stabilityFast: number;
  difficulty: number;
  state: CardState;
  scheduleStatus: CardScheduleStatus;
  /** When the card should be reviewed next (ISO). Indexed as "by-due". */
  dueAt: string;
  /** When it was last reviewed (ISO); null while the card is new. */
  lastReviewAt: string | null;
  reps: number;
  /** Length of the current interval in days (fractional). */
  scheduledDays: number;
  /** Position inside the (re)learning steps, e.g. 0 = first step. */
  learningStep: number;
  /** How many times the user forgot the word after the card had left the "new" state. */
  lapses: number;
  /** True once `lapses` reaches the leech threshold: a word that keeps being forgotten. */
  leech: boolean;
  createdAt: string;
}

/** The two grade buttons: "Unuttum" = again, "Hatırladım" = good. */
export type ReviewGrade = "again" | "good";

/** The ts-fsrs review log entry, with dates turned into ISO strings. */
export interface FsrsRevlog {
  /** ts-fsrs rating number: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: number;
  state: CardState;
  scheduleStatus: CardScheduleStatus;
  stability: number;
  stabilityFast: number;
  difficulty: number;
  dueAt: string;
  lastReviewAt: string | null;
  reviewTime: string;
  scheduledDays: number;
  learningStep: number;
}

/**
 * One answered review. Why keep a log at all?
 * 1. Undo: `previousCard` is the exact card before the review, so it can be restored.
 * 2. Optimisation: FSRS can later fit its own parameters to the user's real answers, which
 *    needs the full history (when, which grade, what state).
 * 3. Statistics: reviews per day, retention rate.
 */
export interface ReviewLog {
  id: string;
  cardId: string;
  grade: ReviewGrade;
  /** When the answer happened (ISO). Indexed as "by-reviewedAt". */
  reviewedAt: string;
  /** The values ts-fsrs recorded for this review (state BEFORE the answer, as ts-fsrs defines it). */
  revlog: FsrsRevlog;
  /** The card exactly as it was before this review. */
  previousCard: Card;
}
