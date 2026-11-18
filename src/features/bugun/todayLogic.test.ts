import { describe, expect, it } from "vitest";
import {
  bookLine,
  computeStrip,
  countWorkedDays,
  dinlemeLine,
  konusmaLine,
  displayMinutes,
  findingLine,
  lastLocalDays,
  pickNextBlock,
  reviewMinutes,
} from "./todayLogic";
import type { MinutesByBlock } from "./todayLogic";

const PLAN: MinutesByBlock = { okuma: 35, kelime: 15, dinleme: 25, konusma: 20 };
const ZERO: MinutesByBlock = { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 };

describe("pickNextBlock", () => {
  it("picks Kelime first while cards are due and its plan is not met", () => {
    expect(pickNextBlock({ doneMinutes: ZERO, planMinutes: PLAN, dueTotal: 38 })).toBe("kelime");
  });
  it("skips Kelime when nothing is due", () => {
    expect(pickNextBlock({ doneMinutes: ZERO, planMinutes: PLAN, dueTotal: 0 })).toBe("okuma");
  });
  it("skips Kelime once its plan is met", () => {
    const done = { ...ZERO, kelime: 15 };
    expect(pickNextBlock({ doneMinutes: done, planMinutes: PLAN, dueTotal: 12 })).toBe("okuma");
  });
  it("takes the first block in order that is below its plan", () => {
    const done = { okuma: 35, kelime: 15, dinleme: 10, konusma: 0 };
    expect(pickNextBlock({ doneMinutes: done, planMinutes: PLAN, dueTotal: 5 })).toBe("dinleme");
  });
  it("falls back to Kelime when everything is done", () => {
    expect(pickNextBlock({ doneMinutes: PLAN, planMinutes: PLAN, dueTotal: 5 })).toBe("kelime");
  });
});

describe("findingLine", () => {
  it("says the minimum is done", () => {
    expect(findingLine({ totalDone: 20, minimum: 20, next: "kelime" })).toBe("Minimum tamam. Sırada Kelime var.");
  });
  it("says how many minutes remain to the minimum", () => {
    expect(findingLine({ totalDone: 12, minimum: 20, next: "konusma" })).toBe(
      "Minimum için 8\u00A0dk kaldı. Sırada Konuşma var.",
    );
  });
});

describe("computeStrip", () => {
  it("makes four segments proportional to the plan", () => {
    const strip = computeStrip({ planMinutes: PLAN, doneMinutes: ZERO, minimum: 20 });
    expect(strip.segments.map((s) => s.flex)).toEqual([35, 15, 25, 20]);
    expect(strip.gapsTotal).toBe(6);
  });
  it("fills each segment to its done minutes and never past 100", () => {
    const strip = computeStrip({
      planMinutes: PLAN,
      doneMinutes: { okuma: 17.5, kelime: 40, dinleme: 0, konusma: 5 },
      minimum: 20,
    });
    expect(strip.segments.map((s) => s.fillPercent)).toEqual([50, 100, 0, 25]);
  });
  it("puts the minimum tick at minute 20 inside the first segment (no gap before it)", () => {
    const strip = computeStrip({ planMinutes: PLAN, doneMinutes: ZERO, minimum: 20 });
    expect(strip.tick.fraction).toBeCloseTo(20 / 95);
    expect(strip.tick.gapsBefore).toBe(0);
  });
  it("counts one gap before a tick that falls in the second segment", () => {
    const strip = computeStrip({ planMinutes: PLAN, doneMinutes: ZERO, minimum: 40 });
    expect(strip.tick.gapsBefore).toBe(1);
  });
  it("keeps a tick on a segment boundary at the end of the earlier segment", () => {
    const strip = computeStrip({ planMinutes: PLAN, doneMinutes: ZERO, minimum: 35 });
    expect(strip.tick.gapsBefore).toBe(0);
  });
  it("handles a zero plan without dividing by zero", () => {
    const zeroPlan: MinutesByBlock = { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 };
    const strip = computeStrip({ planMinutes: zeroPlan, doneMinutes: ZERO, minimum: 20 });
    expect(strip.tick.fraction).toBe(0);
    expect(strip.segments.every((s) => s.fillPercent === 0)).toBe(true);
  });
});

describe("last 7 days", () => {
  it("lists 7 local days across a month end, oldest first", () => {
    const days = lastLocalDays(new Date(2026, 11, 2, 15, 0), 7);
    expect(days).toEqual([
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });
  it("counts days that reached the minimum (>=)", () => {
    expect(countWorkedDays([0, 19, 20, 45, 0, 20, 8], 20)).toBe(3);
  });
  it("counts zero when no day reached it", () => {
    expect(countWorkedDays([0, 0, 0, 0, 0, 0, 0], 20)).toBe(0);
  });
});

describe("displayMinutes", () => {
  it("rounds to whole minutes and never goes negative", () => {
    expect(displayMinutes(0.4)).toBe(0);
    expect(displayMinutes(1.5)).toBe(2);
    expect(displayMinutes(-3)).toBe(0);
  });
});

describe("reviewMinutes", () => {
  it("shows 0 when the queue is empty", () => {
    expect(reviewMinutes(0, 0)).toBe(0);
  });
  it("shows at least 1 minute for one card (0.33 min rounds up)", () => {
    expect(reviewMinutes(1, 20 / 60)).toBe(1);
  });
  it("rounds the estimate up to whole minutes", () => {
    expect(reviewMinutes(3, 1)).toBe(1);
    expect(reviewMinutes(4, 80 / 60)).toBe(2);
    expect(reviewMinutes(45, 15)).toBe(15);
  });
});

describe("bookLine", () => {
  it("writes title, unit and page", () => {
    expect(bookLine({ title: "Reader at Work 1", unit: 3, page: 42 })).toBe("Reader at Work 1 · ünite 3 · s. 42");
  });
});

describe("dinlemeLine", () => {
  it("says there is no video when the list is empty", () => {
    expect(dinlemeLine([])).toBe("Sıradaki video yok");
  });
  it("shows the first video's title", () => {
    expect(dinlemeLine([{ title: "Slow English" }])).toBe("Slow English");
  });
  it("adds how many more are waiting", () => {
    expect(dinlemeLine([{ title: "A" }, { title: "B" }, { title: "C" }])).toBe("A · +2 video");
  });
});

describe("konusmaLine", () => {
  it("keeps the plain line without target words", () => {
    expect(konusmaLine(0)).toBe("Bugün okuduğunu anlat");
  });
  it("shows the target word count", () => {
    expect(konusmaLine(6)).toBe("Bugün okuduğunu anlat · 6 hedef kelime");
  });
});
