// Pure helpers for the Dinleme screen. No React and no database in here, so Vitest can test them
// in plain node and the components only have to show the result.

import type { VideoLevel, VideoUnderstanding } from "../../../data";
import type { LocalDay } from "../../../data/localDay";
import { projectGoalDate } from "./listening";

// A non-breaking space keeps "12 / 25 dk" and "17 Kasım 2026" on one line.
const NBSP = "\u00A0";

/**
 * The listening goal in hours. Kept as a constant on purpose: the settings store has no field
 * for it yet, and this task must not change the data layer. When the user should be able to edit
 * it, add a `listeningGoalHours` setting and read it here instead.
 */
export const LISTENING_GOAL_HOURS = 50;

/** Longest single entry we accept, in minutes (10 hours). Anything above is almost surely a typo. */
export const MAX_MINUTES = 600;

/** Number of bars in the "last days" chart. Same window as the pace in listening.ts. */
export const BAR_DAYS = 14;

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/** The right side of the screen title: "12 / 25 dk". */
export function formatDoneOfPlan(done: number, plan: number): string {
  return `${done}${NBSP}/${NBSP}${plan}${NBSP}dk`;
}

/**
 * Parses a minutes field. Only whole numbers from 1 to 600 are valid; "12.5", "-3", "1e2" and
 * "" are not. Returns null for anything invalid so the caller shows one clear error text.
 */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_MINUTES ? value : null;
}

/** "17 Kasım 2026" for a local day string "2026-11-17". Month names come from a table, not Intl. */
export function formatGoalDate(day: LocalDay): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  return `${dayOfMonth}${NBSP}${MONTHS[month - 1] ?? ""}${NBSP}${year}`;
}

/** Goal progress as a whole percent, never above 100. */
export function goalPercent(totalMinutes: number, goalHours: number): number {
  const goalMinutes = goalHours * 60;
  if (!(goalMinutes > 0)) return 0;
  return Math.min(100, Math.round((Math.max(0, totalMinutes) / goalMinutes) * 100));
}

/** Average minutes per day over the bars, rest days included (same honest rule as listening.ts). */
export function paceFromDayMinutes(dayMinutes: readonly number[]): number {
  if (dayMinutes.length === 0) return 0;
  let sum = 0;
  for (const minutes of dayMinutes) sum += minutes;
  return sum / dayMinutes.length;
}

export interface ForecastText {
  /** The big line: a date, "Hedefe ulaştın" or "Hesaplanamadı". */
  date: string;
  /** The small line under it. */
  note: string;
}

/**
 * The "Tahmini tarih" texts. Three honest cases: goal reached, no pace to project from, or a date.
 * The date itself comes from `projectGoalDate`, so the screen and the tested logic cannot differ.
 */
export function forecastText(
  totalMinutes: number,
  goalHours: number,
  paceMinutes: number,
  now: Date = new Date(),
): ForecastText {
  if (totalMinutes >= goalHours * 60) {
    return { date: "Hedefe ulaştın", note: "Yeni bir hedef koyabilirsin." };
  }
  const day = projectGoalDate(totalMinutes, goalHours, paceMinutes, now);
  if (day === null) return { date: "Hesaplanamadı", note: "Son 14 günde kayıt yok." };
  const daysLeft = Math.ceil((goalHours * 60 - totalMinutes) / paceMinutes);
  return {
    date: formatGoalDate(day),
    // Only the days left: the daily average is already the cell next to this one (the draft shows no repeat).
    note: `${daysLeft}${NBSP}gün sonra`,
  };
}

export interface BarModel {
  /** Height in percent of the chart (0 means "no listening that day": drawn as a thin stub). */
  heightPercent: number;
  minutes: number;
}

/**
 * Bar heights and the dashed daily-plan line position, both in percent of the chart height.
 * The scale is the largest of the bars and the plan, so the dashed line is always inside the chart.
 */
export function buildBars(
  dayMinutes: readonly number[],
  planMinutes: number,
): { bars: BarModel[]; planPercent: number } {
  const scale = Math.max(1, planMinutes, ...dayMinutes);
  return {
    bars: dayMinutes.map((minutes) => ({ minutes, heightPercent: (minutes / scale) * 100 })),
    planPercent: (Math.max(0, planMinutes) / scale) * 100,
  };
}

/** Screen-reader text for the bar chart: "Son 14 gün, günlük dakika: 0, 20, ...". */
export function barsLabel(dayMinutes: readonly number[], planMinutes: number): string {
  const list = dayMinutes.map((minutes) => Math.round(minutes)).join(", ");
  return `Son ${dayMinutes.length} gün, günlük dakika: ${list}. Kesik çizgi günlük ${planMinutes} dakika hedefi.`;
}

/** "3 video · 41 dk" under the list switch. */
export function listCountText(count: number, totalMinutes: number): string {
  return `${count}${NBSP}video · ${totalMinutes}${NBSP}dk`;
}

export const LEVEL_OPTIONS: ReadonlyArray<{ value: VideoLevel; label: string }> = [
  { value: "kolay", label: "Kolay" },
  { value: "orta", label: "Orta" },
  { value: "zor", label: "Zor" },
];

export const UNDERSTANDING_OPTIONS: ReadonlyArray<{ value: VideoUnderstanding; label: string }> = [
  { value: "az", label: "Az" },
  { value: "yarisi", label: "Yarısı" },
  { value: "cogu", label: "Çoğu" },
];

/** Turkish label of a stored level, e.g. "kolay" -> "Kolay". */
export function levelLabel(level: VideoLevel): string {
  return LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

/** Turkish label of a stored understanding, e.g. "yarisi" -> "Yarısı". */
export function understandingLabel(value: VideoUnderstanding): string {
  return UNDERSTANDING_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** The two expected failures of the link field, in the user's words. */
export const LINK_ERROR_TEXT = {
  invalid: "Bu bir YouTube linki değil.",
  duplicate: "Bu video zaten listede.",
} as const;

export const MINUTES_ERROR_TEXT = `Süre için 1 ile ${MAX_MINUTES} arasında bir sayı yaz.`;
export const EXTERNAL_MINUTES_ERROR_TEXT = `1 ile ${MAX_MINUTES} arasında bir dakika yaz.`;

/** Thumbnail address YouTube serves for every public video. Used for cards; no API key needed. */
export function thumbnailUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`;
}

/**
 * Whole minutes shown as "done" today. `loggedMinutes` is saved activity (may have a fraction);
 * `runningSeconds` is a Dinleme timer that is still running (started from Bugün). We add in
 * seconds and round DOWN once, so the number never jumps ahead of the clock.
 */
export function doneWithRunning(loggedMinutes: number, runningSeconds: number): number {
  return Math.floor((loggedMinutes * 60 + Math.max(0, runningSeconds)) / 60);
}
