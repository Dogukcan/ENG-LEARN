// Pure helpers for the İstatistik screen. The screen only loads data and draws; every number
// and sentence is decided here so tests can check it without a database or a browser.

import type { CategoryWeeks, DayMinutes, NgslBand, ReviewSuccess, SkillBlock } from "../../data";
import { SKILL_BLOCKS } from "../../data";
import { addLocalDays, type LocalDay } from "../../data/localDay";
import { ERROR_CATEGORY_LABELS, isErrorCategory } from "../konusma/logic/errorCategories";
import { forecastState, formatHoursMinutes } from "../dinleme/logic/listening";
export { LISTENING_GOAL_HOURS } from "../dinleme/logic/listening";

export const NBSP = "\u00A0";

/** Days the listening pace is measured over (same window as the Dinleme screen). */
export const PACE_DAYS = 14;

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
// Index 0 is Sunday, like Date.getDay().
const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Splits "2026-11-18" into numbers. A local Date is built from the parts so no UTC shift can happen. */
function dayParts(day: LocalDay): { year: number; month: number; date: number; weekday: number } {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(year, month - 1, date).getDay();
  return { year, month, date, weekday };
}

export function weekdayShort(day: LocalDay): string {
  return WEEKDAYS[dayParts(day).weekday];
}

/** "18 Kasım" (the year is added when `withYear` is true). Uses a no-break space so it never wraps mid-date. */
export function formatDay(day: LocalDay, withYear = false): string {
  const { year, month, date } = dayParts(day);
  const base = `${date}${NBSP}${MONTHS[month - 1]}`;
  return withYear ? `${base}${NBSP}${year}` : base;
}

export function dayTotal(minutes: Record<SkillBlock, number>): number {
  return SKILL_BLOCKS.reduce((sum, block) => sum + minutes[block], 0);
}

/** Whole minutes for display. The data layer returns fractions because it sums seconds. */
export function wholeMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes));
}

export function percent(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round((part / whole) * 100);
}

// ---------- 7-day stacked columns ----------

export interface ColumnSegment {
  block: SkillBlock;
  minutes: number;
  /** Segment height as a percentage of the column. */
  heightPercent: number;
}

export interface WeekColumn {
  day: LocalDay;
  label: string;
  total: number;
  segments: ColumnSegment[];
  ariaLabel: string;
}

export interface WeekColumns {
  columns: WeekColumn[];
  /** Distance of the dashed daily-minimum line from the column bottom, in percent. */
  minimumLinePercent: number;
}

/**
 * Columns for the last 7 days. The tallest day (or the daily minimum, whichever is larger) is
 * 100% high, so the dashed minimum line is always inside the chart and empty days stay empty.
 */
export function buildWeekColumns(days: readonly DayMinutes[], dailyMinimum: number, today: LocalDay): WeekColumns {
  const last7 = days.slice(-7);
  const scale = Math.max(dailyMinimum, ...last7.map((entry) => dayTotal(entry.minutes)), 1);
  const columns = last7.map((entry) => {
    const total = wholeMinutes(dayTotal(entry.minutes));
    const segments = SKILL_BLOCKS.map((block) => ({
      block,
      minutes: entry.minutes[block],
      heightPercent: (entry.minutes[block] / scale) * 100,
    }));
    const verdict = total >= dailyMinimum ? `${dailyMinimum} dakika karşılandı` : `${dailyMinimum} dakikanın altında`;
    return {
      day: entry.day,
      label: entry.day === today ? "Bugün" : weekdayShort(entry.day),
      total,
      segments,
      ariaLabel: `${formatDay(entry.day)}: ${total} dakika, ${verdict}`,
    };
  });
  return { columns, minimumLinePercent: (dailyMinimum / scale) * 100 };
}

export interface WeeklyBlockRow {
  block: SkillBlock;
  done: number;
  plan: number;
}

/** Minutes done in the last 7 days against 7 days of the block plan. */
export function weeklyByBlock(
  days: readonly DayMinutes[],
  planPerDay: Record<SkillBlock, number>,
): WeeklyBlockRow[] {
  const last7 = days.slice(-7);
  return SKILL_BLOCKS.map((block) => ({
    block,
    done: wholeMinutes(last7.reduce((sum, entry) => sum + entry.minutes[block], 0)),
    plan: planPerDay[block] * 7,
  }));
}

// ---------- 30-day grid ----------

/** Minutes in the last 30 days against 30 days of the block plan, including empty days. */
export function monthlyByBlock(
  days: readonly DayMinutes[],
  planPerDay: Record<SkillBlock, number>,
): WeeklyBlockRow[] {
  return SKILL_BLOCKS.map((block) => ({
    block,
    done: wholeMinutes(days.slice(-30).reduce((sum, entry) => sum + entry.minutes[block], 0)),
    plan: planPerDay[block] * 30,
  }));
}

export interface MonthCell {
  day: LocalDay;
  met: boolean;
  ariaLabel: string;
}

export function buildMonthGrid(days: readonly DayMinutes[], dailyMinimum: number): MonthCell[] {
  return days.slice(-30).map((entry) => {
    const total = wholeMinutes(dayTotal(entry.minutes));
    const met = total >= dailyMinimum;
    return {
      day: entry.day,
      met,
      ariaLabel: `${formatDay(entry.day)}: ${total} dakika, ${met ? `${dailyMinimum} dakika karşılandı` : `${dailyMinimum} dakikanın altında`}`,
    };
  });
}

/** "6 / 7 gün · %86" */
export function consistencyText(met: number, total: number): string {
  return `${met}${NBSP}/${NBSP}${total}${NBSP}gün · %${percent(met, total)}`;
}

// ---------- Listening goal ----------

/**
 * One honest sentence about when the goal is reached. The pace is the average of the last 14
 * days divided by 14 (rest days count), like the Dinleme screen, so the date is not too rosy.
 */
export function listeningProjectionText(
  totalMinutes: number,
  goalHours: number,
  days: readonly DayMinutes[],
  today: LocalDay,
): string {
  const [year, month, date] = today.split("-").map(Number);
  const state = forecastState(days.map((entry) => entry.minutes.dinleme), totalMinutes, goalHours, new Date(year, month - 1, date));
  if (state.kind === "reached") return "Hedefe ulaştın.";
  if (state.kind === "none") return `Son ${PACE_DAYS} günde dinleme yok; tarih hesaplanamıyor.`;
  if (state.kind === "early") return "Birkaç gün dinleyince tahmini tarih çıkar.";
  if (state.kind === "far") return "Bu hızla hedef 3 yıldan uzun sürer; günlük ortalama arttıkça tarih yaklaşır.";
  return `Bu hızla ${formatDay(state.day, true)} tarihinde hedefe ulaşırsın.`;
}

export function goalLabel(goalHours: number): string {
  return `Hedef ${formatHoursMinutes(goalHours * 60)}`;
}

// ---------- Words ----------

const BAND_LABELS: Record<NgslBand, string> = {
  "1-1000": "1–1000",
  "1001-2000": "1001–2000",
  "2001-2809": "2001–2809",
  "listede yok": "Listede yok",
};

export interface BandRow {
  band: NgslBand;
  label: string;
  known: number;
}

export function bandRows(perBand: Record<NgslBand, number>): BandRow[] {
  return (Object.keys(BAND_LABELS) as NgslBand[]).map((band) => ({
    band,
    label: BAND_LABELS[band],
    known: perBand[band] ?? 0,
  }));
}

export function sumBands(perBand: Record<NgslBand, number>): number {
  return bandRows(perBand).reduce((sum, row) => sum + row.known, 0);
}

/** "%79" for a rate, or the honest "henüz veri yok" when no card was answered in the last 7 days. */
export function reviewRateText(success: ReviewSuccess): string {
  return success.rate === null ? "henüz veri yok" : `%${Math.round(success.rate * 100)}`;
}

// ---------- Speaking errors ----------

export interface SpeakingRow {
  id: string;
  label: string;
  thisWeek: number;
  lastWeek: number;
  delta: "azaldı" | "arttı" | "aynı kaldı";
}

/**
 * Categories with at least one error in either week, most errors this week first. Unknown
 * category ids (from a hand-edited report) are shown as they are rather than dropped.
 */
export function speakingRows(perCategory: Record<string, CategoryWeeks>): SpeakingRow[] {
  return Object.entries(perCategory)
    .filter(([, weeks]) => weeks.thisWeek > 0 || weeks.lastWeek > 0)
    .map(([id, weeks]) => ({
      id,
      label: isErrorCategory(id) ? ERROR_CATEGORY_LABELS[id] : id,
      thisWeek: weeks.thisWeek,
      lastWeek: weeks.lastWeek,
      delta:
        weeks.thisWeek < weeks.lastWeek ? ("azaldı" as const) : weeks.thisWeek > weeks.lastWeek ? ("arttı" as const) : ("aynı kaldı" as const),
    }))
    .sort((a, b) => b.thisWeek - a.thisWeek || b.lastWeek - a.lastWeek || a.label.localeCompare(b.label, "tr"));
}

export function rangeOfLastDays(today: LocalDay, count: number): { from: LocalDay; to: LocalDay } {
  return { from: addLocalDays(today, -(count - 1)), to: today };
}
