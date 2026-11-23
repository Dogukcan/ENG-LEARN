// Listening-time maths for the Dinleme block.
//
// All functions are pure: they take the logs (and "now") as arguments, so tests need no
// database and no real clock.

import type { ActivityLog } from "../../../data/types";
import { localDayRange, toLocalDay, type LocalDay } from "../../../data/localDay";

/**
 * The listening goal in hours. This is the single source for the goal, read by both the Dinleme
 * and Istatistik screens. When the user should be able to edit it, add a `listeningGoalHours`
 * setting and read it here instead.
 */
export const LISTENING_GOAL_HOURS = 50;

/** How many local days (today included) the pace is measured over. */
export const PACE_WINDOW_DAYS = 14;

function dinlemeSeconds(logs: readonly ActivityLog[]): number {
  let seconds = 0;
  for (const log of logs) {
    if (log.block === "dinleme") seconds += log.seconds;
  }
  return seconds;
}

/**
 * Total listening minutes across all "dinleme" logs. Sums seconds first and rounds down once,
 * so many short sessions do not each lose a fraction of a minute.
 */
export function totalListeningMinutes(logs: readonly ActivityLog[]): number {
  return Math.floor(dinlemeSeconds(logs) / 60);
}

/**
 * Formats minutes the way the screen shows them: "41 sa 30 dk", "2 sa", "45 dk", "0 dk".
 * An exact hour drops the "0 dk" part to keep the text short.
 */
export function formatHoursMinutes(totalMinutes: number): string {
  const safe = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours === 0) return `${minutes} dk`;
  if (minutes === 0) return `${hours} sa`;
  return `${hours} sa ${minutes} dk`;
}

/**
 * Average listening minutes per day over the last 14 local days, today included.
 * We divide by 14 (not by the days that had practice) so rest days honestly lower the pace;
 * otherwise the projected date would be too optimistic.
 */
export function paceMinutesPerDay(logs: readonly ActivityLog[], now: Date = new Date()): number {
  // Local-day boundaries (not "now minus 14 x 24h") keep the window right across time changes.
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PACE_WINDOW_DAYS - 1));
  const windowStart = localDayRange(toLocalDay(firstDay)).start;
  const windowEnd = localDayRange(toLocalDay(now)).end;

  // ISO strings in the same UTC format compare correctly as text, but Date values are clearer.
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);

  const inWindow = logs.filter((log) => {
    const at = Date.parse(log.startedAt);
    return at >= startMs && at < endMs;
  });
  return dinlemeSeconds(inWindow) / 60 / PACE_WINDOW_DAYS;
}

/**
 * The local day on which total listening reaches `goalHours`, if the user keeps the current
 * pace. Returns null when the pace is 0 (no honest answer exists). Returns today when the goal
 * is already reached.
 */
export function projectGoalDate(
  totalMinutes: number,
  goalHours: number,
  paceMinutes: number,
  now: Date = new Date(),
): LocalDay | null {
  if (!(paceMinutes > 0) || !Number.isFinite(paceMinutes)) return null;
  const remaining = goalHours * 60 - totalMinutes;
  if (remaining <= 0) return toLocalDay(now);
  const daysNeeded = Math.ceil(remaining / paceMinutes);
  // Adding to the day-of-month (instead of 24h steps) stays correct across DST changes.
  return toLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysNeeded));
}
