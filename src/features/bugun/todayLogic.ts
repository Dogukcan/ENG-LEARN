// Pure logic for the Bugün (Today) screen. No React and no storage here, so every rule can be
// tested with plain numbers.

import { SKILL_BLOCKS } from "../../data/repository";
import type { SkillBlock } from "../../data/types";
import { toLocalDay } from "../../data/localDay";
import type { LocalDay } from "../../data/localDay";

/** Non-breaking space: keeps "8 dk" on one line, like draft D does. */
export const NBSP = "\u00A0";

export type MinutesByBlock = Record<SkillBlock, number>;

/** Turkish block names as shown in the UI. */
export const BLOCK_NAMES: Record<SkillBlock, string> = {
  okuma: "Okuma",
  kelime: "Kelime",
  dinleme: "Dinleme",
  konusma: "Konuşma",
};

/**
 * Whole minutes to show for a block. The timer records whole minutes, so the live display
 * rounds the same way and a number never "jumps back" when the timer stops.
 */
export function displayMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes));
}

/**
 * Which block comes next (the hero card).
 * Rule from draft D: Kelime first while cards are due and its plan is not met (due cards lose
 * value the longer they wait). Otherwise the first block in the usual order that is below its
 * plan. If everything is done, fall back to Kelime so the hero never has nothing to show.
 */
export function pickNextBlock(input: {
  doneMinutes: MinutesByBlock;
  planMinutes: MinutesByBlock;
  dueTotal: number;
}): SkillBlock {
  const { doneMinutes, planMinutes, dueTotal } = input;
  if (dueTotal > 0 && doneMinutes.kelime < planMinutes.kelime) return "kelime";
  return SKILL_BLOCKS.find((block) => doneMinutes[block] < planMinutes[block]) ?? "kelime";
}

/** The grey line under the title. */
export function findingLine(input: { totalDone: number; minimum: number; next: SkillBlock }): string {
  const { totalDone, minimum, next } = input;
  const name = BLOCK_NAMES[next];
  if (totalDone >= minimum) return `Minimum tamam. Sırada ${name} var.`;
  return `Minimum için ${minimum - totalDone}${NBSP}dk kaldı. Sırada ${name} var.`;
}

/** "Reader at Work 1 · ünite 3 · s. 42" for the hero card and the Okuma row. */
export function bookLine(book: { title: string; unit: number; page: number }): string {
  return `${book.title} · ünite ${book.unit} · s. ${book.page}`;
}

// ---------- Day strip ----------

/** Gap between strip segments in px. The component uses the same number in its CSS. */
export const STRIP_GAP_PX = 2;

export interface StripSegment {
  block: SkillBlock;
  /** CSS flex-grow: proportional to the plan minutes. */
  flex: number;
  /** 0-100, how much of this segment is filled. */
  fillPercent: number;
}

export interface StripGeometry {
  segments: StripSegment[];
  /**
   * Where the minimum tick sits. Total segment width is (100% - gaps). The tick is at
   * `fraction` of that width, plus one gap for every segment that ends BEFORE the minimum minute.
   * CSS: left = calc((100% - gapsTotal) * fraction + gapsBefore * gap)
   */
  tick: { fraction: number; gapsBefore: number };
  gapsTotal: number;
}

/**
 * Geometry of the day strip: four segments proportional to the plan, filled to the done minutes,
 * and the minimum tick placed at the true minimum minute (gaps accounted for).
 */
export function computeStrip(input: {
  planMinutes: MinutesByBlock;
  doneMinutes: MinutesByBlock;
  minimum: number;
}): StripGeometry {
  const { planMinutes, doneMinutes, minimum } = input;
  const totalPlan = SKILL_BLOCKS.reduce((sum, block) => sum + planMinutes[block], 0);

  const segments = SKILL_BLOCKS.map((block) => {
    const plan = planMinutes[block];
    const raw = plan > 0 ? (doneMinutes[block] / plan) * 100 : 0;
    // Clamp to 0-100 and keep one decimal: enough precision for a 12px bar.
    const fillPercent = Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
    return { block, flex: plan, fillPercent };
  });

  const clampedMinimum = Math.min(Math.max(minimum, 0), totalPlan);
  const fraction = totalPlan > 0 ? clampedMinimum / totalPlan : 0;

  // The segment holding the minimum minute is the first one whose end is at or after it.
  // A minimum exactly on a boundary stays at the END of the earlier segment (before the gap).
  let cumulative = 0;
  let gapsBefore = 0;
  for (let index = 0; index < SKILL_BLOCKS.length; index += 1) {
    cumulative += planMinutes[SKILL_BLOCKS[index]];
    if (clampedMinimum <= cumulative) {
      gapsBefore = index;
      break;
    }
    gapsBefore = index + 1;
  }
  gapsBefore = Math.min(gapsBefore, SKILL_BLOCKS.length - 1);

  return {
    segments,
    tick: { fraction, gapsBefore },
    gapsTotal: (SKILL_BLOCKS.length - 1) * STRIP_GAP_PX,
  };
}

// ---------- Last 7 days ----------

/** The last `count` local days, oldest first, the last item being the day of `now`. */
export function lastLocalDays(now: Date, count: number): LocalDay[] {
  const days: LocalDay[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    // Date(y, m, d - back) is local midnight and survives month ends and daylight-saving changes.
    days.push(toLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)));
  }
  return days;
}

/** How many days reached the daily minimum. A day counts when its total is >= the minimum. */
export function countWorkedDays(dayTotals: number[], minimum: number): number {
  return dayTotals.filter((total) => total >= minimum).length;
}
