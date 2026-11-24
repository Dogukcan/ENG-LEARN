import type { SkillBlock } from "../../data/types";
import { formatMMSS } from "../timer/timerMath";
import { BLOCK_NAMES, NBSP } from "./todayLogic";

export const PATH_WIDTH = 358;
export const PATH_HEIGHT = 548;
export const PATH_VIEWBOX = `0 0 ${PATH_WIDTH} ${PATH_HEIGHT}`;
export const RIBBON_PATH = "M 106 64 C 106 138, 252 130, 252 204 C 252 278, 106 270, 106 344 C 106 418, 232 410, 232 482";
export const NODE_ANCHORS = [
  { x: 106, y: 64, side: "right" },
  { x: 252, y: 204, side: "left" },
  { x: 106, y: 344, side: "right" },
  { x: 232, y: 482, side: "left" },
] as const;

export function placementPercent(anchor: { x: number; y: number }) {
  return { left: `${anchor.x / PATH_WIDTH * 100}%`, top: `${anchor.y / PATH_HEIGHT * 100}%` };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
export const ringFraction = (done: number, plan: number): number =>
  plan > 0 ? clamp(done / plan) : done > 0 ? 1 : 0;
export const coveredFraction = (totalDone: number, totalPlan: number): number =>
  totalPlan > 0 ? clamp(totalDone / totalPlan) : 0;

export interface NodeContext {
  next: SkillBlock;
  running: SkillBlock | null;
  done: number;
  plan: number;
}

export function bubbleBlock({ next, running }: Pick<NodeContext, "next" | "running">): SkillBlock {
  return running ?? next;
}

export function nodeState(block: SkillBlock, context: NodeContext): {
  state: "next" | "done" | "calm";
  running: boolean;
} {
  return {
    state: context.next === block ? "next" : context.plan > 0 && context.done >= context.plan ? "done" : "calm",
    running: context.running === block,
  };
}

export function nodeAriaLabel(block: SkillBlock, context: NodeContext): string {
  return `${BLOCK_NAMES[block]}: ${context.done} / ${context.plan} dakika` +
    (context.next === block ? ", sıradaki" : "") +
    (context.plan > 0 && context.done >= context.plan ? ", tamamlandı" : "") +
    (context.running === block ? ", çalışıyor" : "");
}

export interface ActionContext {
  runningSeconds: number | null;
  dueCards: number;
}

export function bubbleLabel(block: SkillBlock, context: ActionContext): string {
  if (context.runningSeconds !== null) return `Durdur · ${formatMMSS(context.runningSeconds)}`;
  if (block === "kelime" && context.dueCards > 0) return `Başla · ${context.dueCards} kart`;
  return "Başla";
}

export function actionLabel(block: SkillBlock, context: ActionContext): string {
  if (context.runningSeconds !== null) return `${BLOCK_NAMES[block]} sayacını durdur`;
  if (block === "kelime") return context.dueCards > 0 ? `Tekrara başla · ${context.dueCards} kart` : "Tekrara başla";
  return `${BLOCK_NAMES[block]} sayacını ${context.runningSeconds !== null ? "durdur" : "başlat"}`;
}

export function actionAriaLabel(block: SkillBlock, context: ActionContext): string {
  if (context.runningSeconds !== null) return actionLabel(block, context);
  if (block === "kelime") return `Kelime tekrarına başla${context.dueCards > 0 ? `, ${context.dueCards} kart` : ""}`;
  return actionLabel(block, context);
}

export function sheetKicker(block: SkillBlock, context: NodeContext & ActionContext): string {
  if (context.runningSeconds !== null) return `Çalışıyor · ${formatMMSS(context.runningSeconds)}`;
  return `${context.next === block ? "Sıradaki · " : ""}${context.done}${NBSP}/${NBSP}${context.plan}${NBSP}dk`;
}
