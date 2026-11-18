// Pure helpers for the shared timer. No React, no browser APIs, so they are easy to test.
//
// Why elapsed time is computed from `startedAt` instead of counting ticks: browsers slow down or
// pause timers in background tabs and a page reload loses a counter. A start timestamp survives
// both, and "now minus start" is always right no matter how many ticks were missed.

import type { SkillBlock } from "../../data";

/** What we keep in localStorage so a running timer survives a reload. */
export interface PersistedTimer {
  block: SkillBlock;
  /** ISO string (UTC). */
  startedAt: string;
}

const BLOCKS: readonly SkillBlock[] = ["okuma", "kelime", "dinleme", "konusma"];

/** Whole seconds between `startedAt` and `nowMs`. Never negative (a clock change must not show "-3"). */
export function elapsedSecondsSince(startedAt: string, nowMs: number): number {
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/**
 * How many seconds to write to the activity log when the timer stops.
 * - 0 seconds run: nothing is written (returns 0).
 * - Anything more: rounded to whole minutes, at least 1 minute, returned in seconds.
 * Why a minimum of one minute: a very short session still counts as "I did it today".
 */
export function secondsToRecord(elapsedSeconds: number): number {
  if (!(elapsedSeconds > 0)) return 0;
  const minutes = Math.max(1, Math.round(elapsedSeconds / 60));
  return minutes * 60;
}

/** "mm:ss" for the running button. Minutes keep growing past 59 ("75:00"), no hour part. */
export function formatMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * Read what localStorage returned and decide if it is a usable timer.
 * Anything odd (not JSON, wrong block, bad date) returns null: a broken saved value must never
 * crash the app on start, it just means "no timer was running".
 */
export function parsePersistedTimer(raw: string | null): PersistedTimer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { block, startedAt } = value as Record<string, unknown>;
  if (typeof block !== "string" || !BLOCKS.includes(block as SkillBlock)) return null;
  if (typeof startedAt !== "string" || Number.isNaN(new Date(startedAt).getTime())) return null;
  return { block: block as SkillBlock, startedAt };
}
