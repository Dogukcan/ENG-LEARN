// Local day helpers.
//
// Why this file exists: activity is stored with UTC timestamps, but the user thinks in local
// days. In Türkiye (UTC+3), practice at 01:30 on 17 November is stored as
// "2026-11-16T22:30:00.000Z". If we grouped by the UTC date, that session would land on the
// wrong day. So we always turn a local calendar day into a [start, end) range of UTC instants
// and query with that range.
//
// These functions are "pure": they read only their arguments and the device time zone (through
// the built-in Date methods), and they change nothing. Pure helpers are easy to test and can be
// reused unchanged by the Supabase implementation in Faz 4.

/** A local calendar day written as "YYYY-MM-DD", e.g. "2026-11-17". */
export type LocalDay = string;

const LOCAL_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The local calendar day (device time zone) that contains `date`. Defaults to now. */
export function toLocalDay(date: Date = new Date()): LocalDay {
  // getFullYear/getMonth/getDate use the device time zone, unlike getUTC* methods.
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The UTC instants where a local day starts (inclusive) and ends (exclusive), as ISO strings.
 * Example in Türkiye: "2026-11-17" -> start "2026-11-16T21:00:00.000Z", end "2026-11-17T21:00:00.000Z".
 * Throws RangeError for text that is not a real "YYYY-MM-DD" date.
 */
export function localDayRange(day: LocalDay): { start: string; end: string } {
  const match = LOCAL_DAY_PATTERN.exec(day);
  if (!match) {
    throw new RangeError(`Invalid local day "${day}", expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const dayOfMonth = Number(match[3]);

  // `new Date(y, m, d)` means local midnight. Using day + 1 for the end (instead of adding
  // 24 hours) stays correct even on days with a daylight-saving change.
  const start = new Date(year, monthIndex, dayOfMonth);
  const end = new Date(year, monthIndex, dayOfMonth + 1);

  // Date silently rolls over bad input (Feb 30 -> Mar 2), so check the parts round-trip.
  if (start.getFullYear() !== year || start.getMonth() !== monthIndex || start.getDate() !== dayOfMonth) {
    throw new RangeError(`Invalid local day "${day}"`);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}
