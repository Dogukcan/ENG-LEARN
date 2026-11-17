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
// - FSRS spaced-repetition card fields are NOT here yet; they arrive in Faz 2.

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
}

/** What the user decided about a word during triage. */
export type WordStatus = "learning" | "known" | "ignored";

/** A sorted word. Only "learning" words will become review cards in Faz 2. */
export interface Word {
  id: string;
  lemma: string;
  status: WordStatus;
  meaningTr?: string;
  sentence?: string;
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
