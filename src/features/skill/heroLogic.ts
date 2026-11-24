import type { SkillBlock } from "../../data/types";
import { ringFraction } from "../bugun/pathLogic";
import { BLOCK_NAMES, NBSP } from "../bugun/todayLogic";
import { formatMMSS } from "../timer/timerMath";

export { ringFraction };

export function heroAriaLabel(block: SkillBlock, done: number, plan: number, running: boolean): string {
  return `${miniRingAriaLabel(block, done, plan)}${running ? ", çalışıyor" : ""}. Ayrıntıyı aç`;
}

export function heroKicker(done: number, plan: number, runningSeconds: number | null): string {
  return runningSeconds !== null
    ? `Çalışıyor · ${formatMMSS(runningSeconds)}`
    : `Bugün · ${done}${NBSP}/${NBSP}${plan}${NBSP}dk`;
}

export function heroRemaining(done: number, plan: number): string {
  if (plan <= 0) return "Plan yok";
  if (done >= plan) return "Bugünkü plan tamam";
  return `${plan - done}${NBSP}dk kaldı`;
}

export function miniRingAriaLabel(block: SkillBlock, done: number, plan: number): string {
  return `${BLOCK_NAMES[block]}: ${done} / ${plan} dakika${plan > 0 && done >= plan ? ", tamamlandı" : ""}`;
}
