import { describe, expect, it } from "vitest";
import type { Card, Word } from "../../../data";
import {
  errorBarRows,
  pickTargetWords,
  plannedDays,
  plannedDaysLine,
  totalErrors,
  wordsLine,
} from "./session";

function word(lemma: string, createdAt: string, status: Word["status"] = "learning"): Word {
  return { id: lemma, lemma, status, source: { kind: "diger" }, createdAt, updatedAt: createdAt } as Word;
}
function entry(lemma: string, dueAt: string, status: Word["status"] = "learning") {
  return { card: { dueAt } as Card, word: word(lemma, "2026-11-01T00:00:00Z", status) };
}

describe("plannedDays", () => {
  it("marks Thursday as today", () => {
    // 2026-11-19 is a Thursday.
    const days = plannedDays(new Date(2026, 10, 19, 12));
    expect(days.map((d) => d.short)).toEqual(["Pzt", "Sal", "Per", "Cmt"]);
    expect(days.filter((d) => d.isToday).map((d) => d.short)).toEqual(["Per"]);
    expect(plannedDaysLine(days)).toBe("Planlı günler: Pzt, Sal, Per (bugün), Cmt");
  });
  it("marks nothing on an unplanned day", () => {
    const days = plannedDays(new Date(2026, 10, 18, 12)); // Wednesday
    expect(days.some((d) => d.isToday)).toBe(false);
    expect(plannedDaysLine(days)).toBe("Planlı günler: Pzt, Sal, Per, Cmt");
  });
});

describe("pickTargetWords", () => {
  it("takes the soonest due learning words, at most 6", () => {
    const queue = ["a", "b", "c", "d", "e", "f", "g"].map((l, i) => entry(l, `2026-11-1${i}T00:00:00Z`));
    queue.reverse();
    expect(pickTargetWords(queue, [])).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("falls back to the newest learning words when the queue is empty", () => {
    const recent = [word("old", "2026-11-01T00:00:00Z"), word("new", "2026-11-10T00:00:00Z"), word("k", "2026-11-12T00:00:00Z", "known")];
    expect(pickTargetWords([], recent)).toEqual(["new", "old"]);
  });
  it("returns an empty list when there is nothing, and skips duplicates", () => {
    expect(pickTargetWords([], [])).toEqual([]);
    const queue = [entry("Dog", "2026-11-10T00:00:00Z"), entry("dog", "2026-11-11T00:00:00Z")];
    expect(pickTargetWords(queue, [])).toEqual(["Dog"]);
  });
});

describe("errorBarRows", () => {
  it("lists every category, biggest first, with percent of the maximum", () => {
    const rows = errorBarRows({ article: 2, preposition: 4 });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ id: "preposition", count: 4, percent: 100 });
    expect(rows[1]).toMatchObject({ id: "article", count: 2, percent: 50 });
    expect(rows[2]).toMatchObject({ id: "tense-aspect", count: 0, percent: 0 });
  });
  it("keeps unknown ids and gives 0 percent when everything is empty", () => {
    expect(errorBarRows({ legacy: 1 })[0]).toMatchObject({ id: "legacy", label: "legacy", percent: 100 });
    expect(errorBarRows({}).every((r) => r.percent === 0)).toBe(true);
    expect(totalErrors({ a: 2, b: 3 })).toBe(5);
  });
});

describe("wordsLine", () => {
  it("reports added and skipped counts", () => {
    expect(wordsLine(3, 1)).toBe("3 kelime gelen kutusuna eklendi, 1 kelime atlandı (zaten listede ya da boş).");
    expect(wordsLine(0, 0)).toBe("Yeni kelime eklenmedi.");
  });
});
