import { describe, expect, it } from "vitest";
import type { DayMinutes } from "../../data";
import {
  bandRows,
  buildMonthGrid,
  buildWeekColumns,
  consistencyText,
  formatDay,
  listeningProjectionText,
  monthlyByBlock,
  rangeOfLastDays,
  reviewRateText,
  speakingRows,
  weekdayShort,
  weeklyByBlock,
} from "./statsLogic";

const zero = { okuma: 0, kelime: 0, dinleme: 0, konusma: 0 };
const day = (d: string, minutes: Partial<typeof zero> = {}): DayMinutes => ({ day: d, minutes: { ...zero, ...minutes } });

describe("day formatting", () => {
  it("names the weekday and month in Turkish", () => {
    expect(weekdayShort("2026-11-18")).toBe("Çar");
    expect(formatDay("2026-11-18")).toBe("18\u00A0Kasım");
    expect(formatDay("2026-11-18", true)).toBe("18\u00A0Kasım\u00A02026");
  });
});

describe("buildWeekColumns", () => {
  const days = [
    day("2026-11-12"),
    day("2026-11-13", { okuma: 10 }),
    day("2026-11-14"),
    day("2026-11-15"),
    day("2026-11-16", { okuma: 20, kelime: 20 }),
    day("2026-11-17"),
    day("2026-11-18", { dinleme: 10 }),
  ];
  it("scales to the tallest day and puts the minimum line inside", () => {
    const result = buildWeekColumns(days, 20, "2026-11-18");
    expect(result.columns).toHaveLength(7);
    expect(result.minimumLinePercent).toBe(50);
    expect(result.columns[4].segments[0].heightPercent).toBe(50);
    expect(result.columns[6].label).toBe("Bugün");
    expect(result.columns[4].ariaLabel).toBe("16\u00A0Kasım: 40 dakika, 20 dakika karşılandı");
  });
  it("keeps the minimum line at 100% when every day is empty", () => {
    const result = buildWeekColumns(days.map((d) => day(d.day)), 20, "2026-11-18");
    expect(result.minimumLinePercent).toBe(100);
  });
});

describe("weeklyByBlock", () => {
  it("compares with seven days of plan", () => {
    const rows = weeklyByBlock([day("2026-11-17", { okuma: 30.4 }), day("2026-11-18", { okuma: 10 })], {
      okuma: 35,
      kelime: 15,
      dinleme: 25,
      konusma: 20,
    });
    expect(rows[0]).toEqual({ block: "okuma", done: 40, plan: 245 });
  });
});

describe("buildMonthGrid and consistencyText", () => {
  it("totals only the last 30 days and keeps empty days in the monthly plan", () => {
    const days = Array.from({ length: 31 }, (_, i) => day("2026-11-18", { okuma: i === 0 ? 999 : 1.25 }));
    expect(monthlyByBlock(days, { okuma: 20, kelime: 15, dinleme: 25, konusma: 0 })).toEqual([
      { block: "okuma", done: 38, plan: 600 },
      { block: "kelime", done: 0, plan: 450 },
      { block: "dinleme", done: 0, plan: 750 },
      { block: "konusma", done: 0, plan: 0 },
    ]);
    expect(monthlyByBlock([], zero).every((row) => row.done === 0 && row.plan === 0)).toBe(true);
  });
  it("marks days that reach the minimum", () => {
    const grid = buildMonthGrid([day("2026-11-17", { okuma: 19 }), day("2026-11-18", { okuma: 20 })], 20);
    expect(grid.map((cell) => cell.met)).toEqual([false, true]);
  });
  it("formats the line", () => {
    expect(consistencyText(6, 7)).toBe("6\u00A0/\u00A07\u00A0gün · %86");
  });
});

describe("listeningProjectionText", () => {
  it("says the goal is reached", () => {
    expect(listeningProjectionText(3000, 50, [], "2026-11-18")).toBe("Hedefe ulaştın.");
  });
  it("says it cannot compute without listening", () => {
    const days = rangeOfLastDays("2026-11-18", 14);
    expect(listeningProjectionText(100, 50, [day(days.to)], "2026-11-18")).toBe(
      "Son 14 günde dinleme yok; tarih hesaplanamıyor.",
    );
  });
  it("projects a date from the 14-day pace", () => {
    // 14 min per 14 days = 1 min/day; 2900 min remain => 2900 days. Check only the shape.
    const text = listeningProjectionText(100, 50, [day("2026-11-18", { dinleme: 14 })], "2026-11-18");
    expect(text).toMatch(/^Bu hızla .* tarihinde hedefe ulaşırsın\.$/);
  });
  it("projects an exact date", () => {
    // 100 min/day pace needs 28 more days for the remaining 2800 minutes... pace 100 => 28 days.
    const entries = Array.from({ length: 14 }, (_, i) => day(`2026-11-${String(5 + i).padStart(2, "0")}`, { dinleme: 100 }));
    expect(listeningProjectionText(200, 50, entries, "2026-11-18")).toBe(
      `Bu hızla ${formatDay("2026-12-16", true)} tarihinde hedefe ulaşırsın.`,
    );
  });
});

describe("words and speaking", () => {
  it("keeps band order and labels", () => {
    expect(bandRows({ "1-1000": 5, "1001-2000": 4, "2001-2809": 3, "listede yok": 2 }).map((r) => r.label)).toEqual([
      "1–1000",
      "1001–2000",
      "2001–2809",
      "Listede yok",
    ]);
  });
  it("shows no data honestly", () => {
    expect(reviewRateText({ good: 0, total: 0, rate: null })).toBe("henüz veri yok");
    expect(reviewRateText({ good: 3, total: 4, rate: 0.75 })).toBe("%75");
  });
  it("sorts categories, hides empty ones and words the change", () => {
    const rows = speakingRows({
      article: { thisWeek: 2, lastWeek: 5 },
      preposition: { thisWeek: 4, lastWeek: 4 },
      pronunciation: { thisWeek: 0, lastWeek: 0 },
      mystery: { thisWeek: 4, lastWeek: 1 },
    });
    expect(rows.map((r) => r.id)).toEqual(["preposition", "mystery", "article"]);
    expect(rows.map((r) => r.delta)).toEqual(["aynı kaldı", "arttı", "azaldı"]);
    expect(rows[2].label).toBe("Tanım edatı (a, an, the)");
  });
});
