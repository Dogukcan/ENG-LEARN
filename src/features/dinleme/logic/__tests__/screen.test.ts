import { describe, expect, it } from "vitest";
import {
  buildBars,
  doneWithRunning,
  forecastText,
  formatDoneOfPlan,
  formatGoalDate,
  goalPercent,
  listCountText,
  listeningSubtitle,
  paceFromDayMinutes,
  parseMinutes,
  thumbnailUrl,
} from "../screen";

const NBSP = "\u00A0";

describe("parseMinutes", () => {
  it("accepts whole numbers from 1 to 600", () => {
    expect(parseMinutes("1")).toBe(1);
    expect(parseMinutes(" 12 ")).toBe(12);
    expect(parseMinutes("600")).toBe(600);
  });

  it("rejects zero, too large, decimals, negatives, text and empty", () => {
    for (const bad of ["0", "601", "12.5", "-3", "1e2", "abc", "", "  ", "1000"]) {
      expect(parseMinutes(bad)).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("formats done of plan with non-breaking spaces", () => {
    expect(formatDoneOfPlan(8, 25)).toBe(`8${NBSP}/${NBSP}25${NBSP}dk`);
  });

  it("formats a local day in Turkish", () => {
    expect(formatGoalDate("2026-12-03")).toBe(`3${NBSP}Aralık${NBSP}2026`);
  });

  it("formats the list count", () => {
    expect(listCountText(3, 41)).toBe(`3${NBSP}video · 41${NBSP}dk`);
  });

  it("builds a YouTube thumbnail address", () => {
    expect(thumbnailUrl("abcdefghijk")).toBe("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
  });
});

describe("goalPercent", () => {
  it("rounds and caps at 100", () => {
    expect(goalPercent(1500, 50)).toBe(50);
    expect(goalPercent(4000, 50)).toBe(100);
    expect(goalPercent(0, 50)).toBe(0);
  });

  it("returns 0 for a goal of 0 hours", () => {
    expect(goalPercent(10, 0)).toBe(0);
  });
});

describe("paceFromDayMinutes", () => {
  it("divides by every day, rest days included", () => {
    expect(paceFromDayMinutes([14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1);
    expect(paceFromDayMinutes([])).toBe(0);
  });
});

describe("forecastText", () => {
  const now = new Date(2026, 10, 17, 12, 0);

  it("projects a date from the pace", () => {
    // 100 minutes left at 25 per day = 4 days -> 21 November.
    const result = forecastText(2900, 50, Array(14).fill(25), now);
    expect(result.date).toBe(`21${NBSP}Kasım${NBSP}2026`);
    expect(result.note).toBe(`4${NBSP}gün sonra`);
  });

  it("says the goal is reached", () => {
    expect(forecastText(3000, 50, [], now)).toEqual({ date: "Hedefe ulaştın", note: "Yeni bir hedef koyabilirsin." });
  });

  it("is honest when there is no pace", () => {
    expect(forecastText(100, 50, Array(14).fill(0), now)).toEqual({ date: "Hesaplanamadı", note: "Son 14 günde kayıt yok." });
  });

  it("shows early for the reported one-minute case and exactly two active days", () => {
    for (const minutes of [[1, ...Array(13).fill(0)], [175, 175, ...Array(12).fill(0)]]) {
      expect(forecastText(1, 50, minutes, now)).toEqual({
        date: "Henüz erken", note: "Birkaç gün dinleyince tarih çıkar.",
      });
    }
  });

  it("shows a date at exactly three active days", () => {
    expect(forecastText(2900, 50, [100, 100, 150, ...Array(11).fill(0)], now)).toEqual({
      date: `21${NBSP}Kasım${NBSP}2026`, note: `4${NBSP}gün sonra`,
    });
  });

  it("shows far for three active days with tiny minutes", () => {
    expect(forecastText(3, 50, [1, 1, 1, ...Array(11).fill(0)], now)).toEqual({
      date: "3 yıldan uzun", note: "Günlük ortalama arttıkça tarih yaklaşır.",
    });
  });
});

describe("buildBars", () => {
  it("scales to the largest of bars and plan", () => {
    const { bars, planPercent } = buildBars([0, 50, 25], 25);
    expect(bars.map((bar) => bar.heightPercent)).toEqual([0, 100, 50]);
    expect(planPercent).toBe(50);
  });

  it("keeps the plan line inside the chart when every bar is lower", () => {
    const { bars, planPercent } = buildBars([5, 10], 25);
    expect(planPercent).toBe(100);
    expect(bars[1]?.heightPercent).toBe(40);
  });

  it("does not divide by zero with no data and no plan", () => {
    expect(buildBars([0, 0], 0)).toEqual({
      bars: [
        { minutes: 0, heightPercent: 0 },
        { minutes: 0, heightPercent: 0 },
      ],
      planPercent: 0,
    });
  });
});

describe("doneWithRunning", () => {
  it("adds the running timer in seconds and rounds down once", () => {
    expect(doneWithRunning(10.5, 29)).toBe(10);
    expect(doneWithRunning(10.5, 30)).toBe(11);
    expect(doneWithRunning(0, 0)).toBe(0);
    expect(doneWithRunning(5, -20)).toBe(5);
  });
});


describe("listeningSubtitle", () => {
  it("formats lifetime listening against the shared goal", () => {
    expect(listeningSubtitle(760)).toBe("Toplam 12 sa 40 dk / 50 sa");
    expect(listeningSubtitle(0)).toBe("Toplam 0 dk / 50 sa");
    expect(listeningSubtitle(60)).toBe("Toplam 1 sa / 50 sa");
  });

  it("keeps totals at and beyond the goal visible", () => {
    expect(listeningSubtitle(3000)).toBe("Toplam 50 sa / 50 sa");
    expect(listeningSubtitle(3061)).toBe("Toplam 51 sa 1 dk / 50 sa");
  });
});
