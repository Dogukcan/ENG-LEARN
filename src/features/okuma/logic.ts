// Pure helpers for the Okuma screen. They have no React and no database inside, so Vitest can test
// them in plain node. The components only call them and show the result.

import { localDayRange, toLocalDay } from "../../data";
import type { Book, CaptureSource, InboxItem } from "../../data";

// A non-breaking space keeps "12 / 35 dk" on one line instead of wrapping in the middle.
const NBSP = "\u00A0";

/** Page and unit numbers are 1-based, so a minus tap on 1 stays on 1 instead of reaching 0. */
export function stepValue(current: number, delta: 1 | -1): number {
  return Math.max(1, current + delta);
}

/** "mm:ss" for the running timer. Minutes may pass 59 ("75:03"): the draft has no hour part. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Whole minutes shown as "done". `loggedMinutes` comes from the saved activity (it can have a
 * fraction); `runningSeconds` is the live timer of this block. We add in seconds and round DOWN
 * once at the end, so the number never jumps ahead of the clock the user sees.
 */
export function doneMinutes(loggedMinutes: number, runningSeconds: number): number {
  return Math.floor((loggedMinutes * 60 + Math.max(0, runningSeconds)) / 60);
}

/** The right side of the screen title: "12 / 35 dk". */
export function titleProgress(done: number, plan: number): string {
  return `${done}${NBSP}/${NBSP}${plan}${NBSP}dk`;
}

/** The three expected failures of inbox.add, in the user's words (same texts as the Kelime form). */
export const CAPTURE_ERROR_TEXT = {
  empty: "Kelime boş olamaz.",
  duplicate: "Bu kelime zaten gelen kutusunda.",
  "already-learning": "Bu kelimeyi zaten öğreniyorsun.",
} as const;

/** "RW1 · s. 42". If the book was deleted, only the page is shown. */
export function bookSourceLine(source: Extract<CaptureSource, { kind: "kitap" }>, books: readonly Book[]): string {
  const book = books.find((b) => b.id === source.bookId);
  return book ? `${book.shortName} · s. ${source.page}` : `s. ${source.page}`;
}

export interface CapturedRow {
  id: string;
  word: string;
  sentence?: string;
  sourceLine: string;
}

/**
 * Words captured from a book on the local day of `now`, newest first.
 * "Today" is decided with the local day range (device time zone), not the UTC date, so a word
 * captured at 01:30 in Türkiye still counts for that calendar day.
 */
export function capturedToday(inbox: readonly InboxItem[], books: readonly Book[], now: Date): CapturedRow[] {
  const { start, end } = localDayRange(toLocalDay(now));
  const rows: Array<{ createdAt: string; row: CapturedRow }> = [];
  for (const item of inbox) {
    // ISO strings in UTC sort like time, so plain string comparison is a correct range check.
    if (item.source.kind !== "kitap" || item.createdAt < start || item.createdAt >= end) continue;
    rows.push({
      createdAt: item.createdAt,
      row: {
        id: item.id,
        word: item.word,
        ...(item.sentence ? { sentence: item.sentence } : {}),
        sourceLine: bookSourceLine(item.source, books),
      },
    });
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return rows.map((entry) => entry.row);
}
