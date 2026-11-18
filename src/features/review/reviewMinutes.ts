import { secondsToRecord } from "../timer/timerMath";

/**
 * Minutes to record for a review session.
 * Why not plain "now minus start": the session sheet can stay open while the app is in the background
 * (iOS keeps the page in memory), so a night away would write hundreds of Kelime minutes. We drop the
 * time the page was hidden and apply the same 180-minute cap as the shared timer (secondsToRecord).
 * A session with at least one graded card counts for at least 1 minute, like the timer does.
 */
export function reviewSessionMinutes(args: {
  startedAtMs: number;
  endedAtMs: number;
  hiddenMs: number;
  reviewed: number;
}): number {
  if (args.reviewed <= 0) return 0;
  const activeSeconds = Math.max(0, (args.endedAtMs - args.startedAtMs - args.hiddenMs) / 1000);
  return Math.max(1, secondsToRecord(activeSeconds) / 60);
}

/** Add the part of a hidden period that lies inside the session: pages hidden before it opened do not count. */
export function addHiddenTime(hiddenMs: number, hiddenSinceMs: number, nowMs: number, startedAtMs: number): number {
  return hiddenMs + Math.max(0, nowMs - Math.max(hiddenSinceMs, startedAtMs));
}
