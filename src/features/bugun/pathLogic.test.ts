import { describe, expect, it } from "vitest";
import {
  actionAriaLabel, actionLabel, bubbleBlock, bubbleLabel, coveredFraction, NODE_ANCHORS,
  nodeAriaLabel, nodeState, PATH_HEIGHT, PATH_VIEWBOX, PATH_WIDTH,
  placementPercent, RIBBON_PATH, ringFraction, sheetKicker,
} from "./pathLogic";
import { BLOCK_NAMES, NBSP } from "./todayLogic";
import { SKILL_BLOCKS } from "../../data/repository";
import type { NodeContext } from "./pathLogic";

const calm: NodeContext = { next: "kelime", running: null, done: 12, plan: 20 };
const idle = { runningSeconds: null, dueCards: 0 };

describe("path progress", () => {
  it("handles zero plans without dividing by zero", () => {
    expect(ringFraction(0, 0)).toBe(0);
    expect(ringFraction(4, 0)).toBe(1);
    expect(coveredFraction(0, 0)).toBe(0);
    expect(coveredFraction(4, 0)).toBe(0);
    expect(nodeState("okuma", { ...calm, plan: 0 }).state).toBe("calm");
    expect(nodeAriaLabel("okuma", { ...calm, plan: 0 })).toBe("Okuma: 12 / 0 dakika");
  });
  it("clamps ring progress and preserves partial progress", () => {
    expect(ringFraction(12, 20)).toBe(0.6);
    expect(ringFraction(25, 20)).toBe(1);
    expect(ringFraction(-2, 20)).toBe(0);
  });
  it("covers none, part, all, and over-plan totals", () => {
    expect(coveredFraction(0, 75)).toBe(0);
    expect(coveredFraction(30, 75)).toBe(0.4);
    expect(coveredFraction(75, 75)).toBe(1);
    expect(coveredFraction(90, 75)).toBe(1);
    expect(coveredFraction(-3, 75)).toBe(0);
  });
});

describe("node states and accessible names", () => {
  it.each(SKILL_BLOCKS)("puts the only bubble on the running %s block, preserving next status", (running) => {
    for (const next of SKILL_BLOCKS) {
      const context = { ...calm, next, running };
      expect(bubbleBlock(context)).toBe(running);
      expect(SKILL_BLOCKS.filter((block) => bubbleBlock(context) === block)).toEqual([running]);
      expect(nodeState(next, context).state).toBe("next");
    }
  });
  it.each(SKILL_BLOCKS)("puts the bubble on next %s when no timer runs", (next) => {
    expect(bubbleBlock({ next, running: null })).toBe(next);
  });
  it("identifies calm, next, done, and independently running nodes", () => {
    expect(nodeState("okuma", calm)).toEqual({ state: "calm", running: false });
    expect(nodeState("kelime", calm)).toEqual({ state: "next", running: false });
    expect(nodeState("okuma", { ...calm, done: 20 })).toEqual({ state: "done", running: false });
    expect(nodeState("okuma", { ...calm, running: "okuma" })).toEqual({ state: "calm", running: true });
    expect(nodeState("kelime", { ...calm, done: 20, running: "kelime" })).toEqual({ state: "next", running: true });
  });
  it("announces every applicable state, including a completed next node", () => {
    expect(nodeAriaLabel("okuma", calm)).toBe("Okuma: 12 / 20 dakika");
    expect(nodeAriaLabel("kelime", calm)).toBe("Kelime: 12 / 20 dakika, sıradaki");
    expect(nodeAriaLabel("okuma", { ...calm, done: 20 })).toBe("Okuma: 20 / 20 dakika, tamamlandı");
    expect(nodeAriaLabel("okuma", { ...calm, running: "okuma" })).toBe("Okuma: 12 / 20 dakika, çalışıyor");
    expect(nodeAriaLabel("kelime", { ...calm, done: 21, running: "kelime" })).toBe("Kelime: 21 / 20 dakika, sıradaki, tamamlandı, çalışıyor");
  });
});

describe("Turkish actions and sheet labels", () => {
  it.each(SKILL_BLOCKS.filter((block) => block !== "kelime"))("labels the %s timer action", (block) => {
    expect(bubbleLabel(block, idle)).toBe("Başla");
    expect(actionLabel(block, idle)).toBe(`${BLOCK_NAMES[block]} sayacını başlat`);
    expect(actionAriaLabel(block, idle)).toBe(actionLabel(block, idle));
    const running = { runningSeconds: 125, dueCards: 23 };
    expect(bubbleLabel(block, running)).toBe("Durdur · 02:05");
    expect(actionLabel(block, running)).toBe(`${BLOCK_NAMES[block]} sayacını durdur`);
    expect(actionAriaLabel(block, running)).toBe(actionLabel(block, running));
    expect(bubbleLabel(block, { ...running, runningSeconds: 0 })).toBe("Durdur · 00:00");
  });
  it("labels Kelime with zero and 23 due cards", () => {
    expect(bubbleLabel("kelime", idle)).toBe("Başla");
    expect(actionLabel("kelime", idle)).toBe("Tekrara başla");
    expect(actionAriaLabel("kelime", idle)).toBe("Kelime tekrarına başla");
    const due = { ...idle, dueCards: 23 };
    expect(bubbleLabel("kelime", due)).toBe("Başla · 23 kart");
    expect(actionLabel("kelime", due)).toBe("Tekrara başla · 23 kart");
    expect(actionAriaLabel("kelime", due)).toBe("Kelime tekrarına başla, 23 kart");
    expect(bubbleLabel("kelime", { ...due, runningSeconds: 65 })).toBe("Durdur · 01:05");
    expect(actionLabel("kelime", { ...due, runningSeconds: 65 })).toBe("Kelime sayacını durdur");
    expect(actionAriaLabel("kelime", { ...due, runningSeconds: 65 })).toBe("Kelime sayacını durdur");
  });
  it("shows minutes, next status, and running time in the sheet kicker", () => {
    const minutes = `12${NBSP}/${NBSP}20${NBSP}dk`;
    expect(sheetKicker("okuma", { ...calm, ...idle })).toBe(minutes);
    expect(sheetKicker("kelime", { ...calm, ...idle })).toBe(`Sıradaki · ${minutes}`);
    expect(sheetKicker("okuma", { ...calm, ...idle, runningSeconds: 65 })).toBe("Çalışıyor · 01:05");
    expect(sheetKicker("kelime", { ...calm, ...idle, runningSeconds: 0 })).toBe("Çalışıyor · 00:00");
  });
});

describe("responsive path geometry", () => {
  it("keeps the specified anchors, sides, and ribbon", () => {
    expect(PATH_VIEWBOX).toBe("0 0 358 548");
    expect(NODE_ANCHORS).toEqual([
      { x: 106, y: 64, side: "right" }, { x: 252, y: 204, side: "left" },
      { x: 106, y: 344, side: "right" }, { x: 232, y: 482, side: "left" },
    ]);
    expect(RIBBON_PATH).toBe("M 106 64 C 106 138, 252 130, 252 204 C 252 278, 106 270, 106 344 C 106 418, 232 410, 232 482");
  });
  it("places anchors in viewBox percentages", () => {
    for (const anchor of NODE_ANCHORS) {
      const placement = placementPercent(anchor);
      expect(parseFloat(placement.left)).toBeCloseTo(anchor.x / PATH_WIDTH * 100);
      expect(parseFloat(placement.top)).toBeCloseTo(anchor.y / PATH_HEIGHT * 100);
      expect(placement.left.endsWith("%")).toBe(true);
      expect(placement.top.endsWith("%")).toBe(true);
    }
    expect(placementPercent({ x: 179, y: 274 })).toEqual({ left: "50%", top: "50%" });
  });
});
