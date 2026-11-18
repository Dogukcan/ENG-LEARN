// Small pure helpers for the Konuşma screen. No React and no database in here, so Vitest can
// test them in plain node and the components only have to call them.

import type { Card, Word } from "../../../data";
import { ERROR_CATEGORY_IDS, ERROR_CATEGORY_LABELS, isErrorCategory } from "./errorCategories";

/** The planned speaking days (the plan says four days a week). 0 = Sunday ... 6 = Saturday. */
export const PLANNED_WEEKDAYS = [
  { weekday: 1, short: "Pzt", full: "Pazartesi" },
  { weekday: 2, short: "Sal", full: "Salı" },
  { weekday: 4, short: "Per", full: "Perşembe" },
  { weekday: 6, short: "Cmt", full: "Cumartesi" },
] as const;

export interface PlannedDay {
  short: string;
  full: string;
  isToday: boolean;
}

/**
 * The four planned days with today marked. `getDay()` uses the device time zone, which is what
 * "today" means for the learner. If today is not a planned day nothing is marked.
 */
export function plannedDays(now: Date): PlannedDay[] {
  const today = now.getDay();
  return PLANNED_WEEKDAYS.map((day) => ({ short: day.short, full: day.full, isToday: day.weekday === today }));
}

/** "Planlı günler: Pzt, Sal, Per (bugün), Cmt" - today is marked in words, not only by colour. */
export function plannedDaysLine(days: readonly PlannedDay[]): string {
  const list = days.map((day) => (day.isToday ? `${day.short} (bugün)` : day.short)).join(", ");
  return `Planlı günler: ${list}`;
}

/** Whether today is one of the planned days, for the quiet hint under the title. */
export function isPlannedToday(days: readonly PlannedDay[]): boolean {
  return days.some((day) => day.isToday);
}

export const MAX_TARGET_WORDS = 6;

/**
 * Target words for the prompt: the learning words whose cards are due soonest from the review
 * queue. With an empty queue we fall back to the most recently added learning words, so a learner
 * who just started still gets useful targets. No words at all gives an empty list (and the
 * screen then shows no target-word line).
 */
export function pickTargetWords(
  queue: ReadonlyArray<{ card: Card; word: Word }>,
  recentLearning: readonly Word[],
  max: number = MAX_TARGET_WORDS,
): string[] {
  const source: string[] =
    queue.length > 0
      ? [...queue]
          .filter((entry) => entry.word.status === "learning")
          .sort((a, b) => a.card.dueAt.localeCompare(b.card.dueAt))
          .map((entry) => entry.word.lemma)
      : [...recentLearning]
          .filter((word) => word.status === "learning")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((word) => word.lemma);
  // The same lemma could appear twice (two cards, or a re-captured word); keep the first.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const lemma of source) {
    const key = lemma.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    unique.push(lemma.trim());
    if (unique.length >= max) break;
  }
  return unique;
}

export interface ErrorBarRow {
  id: string;
  label: string;
  count: number;
  /** Bar length as a percentage of the largest count (0 when there are no errors at all). */
  percent: number;
}

/**
 * Rows for the weekly error list: every known category (so the list does not jump around),
 * most errors first, ties keep the category order. Unknown category ids from old data are
 * shown under their own id instead of being dropped, so the total stays honest.
 */
export function errorBarRows(counts: Readonly<Record<string, number>>): ErrorBarRow[] {
  const ids: string[] = [...ERROR_CATEGORY_IDS];
  for (const id of Object.keys(counts)) if (!ids.includes(id)) ids.push(id);
  const rows = ids.map((id, order) => ({
    id,
    order,
    label: isErrorCategory(id) ? ERROR_CATEGORY_LABELS[id] : id,
    count: counts[id] ?? 0,
  }));
  rows.sort((a, b) => b.count - a.count || a.order - b.order);
  const max = rows.reduce((biggest, row) => Math.max(biggest, row.count), 0);
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    count: row.count,
    percent: max > 0 ? Math.round((row.count / max) * 100) : 0,
  }));
}

export function totalErrors(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** "3 kelime eklendi, 1 kelime zaten vardı." Plain Turkish for the result of saving a report. */
export function wordsLine(added: number, skipped: number): string {
  const parts: string[] = [];
  parts.push(added === 0 ? "Yeni kelime eklenmedi" : `${added} kelime gelen kutusuna eklendi`);
  if (skipped > 0) parts.push(`${skipped} kelime atlandı (zaten listede ya da boş)`);
  return `${parts.join(", ")}.`;
}

/** Label of an error category id; unknown ids are shown as they are. */
export function categoryLabel(id: string): string {
  return isErrorCategory(id) ? ERROR_CATEGORY_LABELS[id] : id;
}
