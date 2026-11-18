import { describe, expect, it } from "vitest";
import type { ActivityLog } from "../../../../data/types";
import { formatHoursMinutes, paceMinutesPerDay, projectGoalDate, totalListeningMinutes } from "../listening";

// Dates use local-time constructors so the tests pass in any time zone.
let counter = 0;
function log(block: ActivityLog["block"], when: Date, minutes: number): ActivityLog {
  counter += 1;
  return {
    id: `l${counter}`,
    block,
    startedAt: when.toISOString(),
    updatedAt: when.toISOString(),
    seconds: Math.round(minutes * 60),
    source: "manual",
  };
}

describe("totalListeningMinutes", () => {
  it("counts only dinleme and rounds down once at the end", () => {
    const at = new Date(2026, 10, 17, 10);
    const logs = [log("dinleme", at, 10.5), log("dinleme", at, 10.5), log("okuma", at, 99)];
    expect(totalListeningMinutes(logs)).toBe(21);
  });
  it("is 0 for no logs", () => {
    expect(totalListeningMinutes([])).toBe(0);
  });
});

describe("formatHoursMinutes", () => {
  it.each([
    [2490, "41 sa 30 dk"],
    [120, "2 sa"],
    [61, "1 sa 1 dk"],
    [45, "45 dk"],
    [0, "0 dk"],
    [-5, "0 dk"],
    [59.9, "59 dk"],
  ])("%d minutes -> %s", (minutes, text) => {
    expect(formatHoursMinutes(minutes)).toBe(text);
  });
});

describe("paceMinutesPerDay", () => {
  const now = new Date(2026, 10, 17, 12);

  it("averages over 14 days including today", () => {
    const logs = [
      log("dinleme", new Date(2026, 10, 17, 8), 70), // today
      log("dinleme", new Date(2026, 10, 4, 23, 30), 70), // day 14 (oldest day in window)
    ];
    expect(paceMinutesPerDay(logs, now)).toBeCloseTo(140 / 14);
  });

  it("ignores logs older than 14 days and other blocks", () => {
    const logs = [
      log("dinleme", new Date(2026, 10, 3, 23, 59), 500), // day 15: outside
      log("konusma", new Date(2026, 10, 16, 9), 500),
    ];
    expect(paceMinutesPerDay(logs, now)).toBe(0);
  });

  it("ignores logs later than today", () => {
    expect(paceMinutesPerDay([log("dinleme", new Date(2026, 10, 18, 0, 5), 60)], now)).toBe(0);
  });
});

describe("projectGoalDate", () => {
  const now = new Date(2026, 10, 17, 12);

  it("returns null when the pace is 0", () => {
    expect(projectGoalDate(100, 50, 0, now)).toBeNull();
  });

  it("projects the day the goal is reached", () => {
    // Goal 10 h = 600 min, have 300, pace 30/day -> 10 more days.
    expect(projectGoalDate(300, 10, 30, now)).toBe("2026-11-27");
  });

  it("rounds partial days up", () => {
    // 100 min left at 30/day = 3.33 -> 4 days.
    expect(projectGoalDate(500, 10, 30, now)).toBe("2026-11-21");
  });

  it("returns today when the goal is already reached", () => {
    expect(projectGoalDate(700, 10, 30, now)).toBe("2026-11-17");
  });

  it("crosses a year end", () => {
    expect(projectGoalDate(0, 1, 1, new Date(2026, 11, 20))).toBe("2027-02-18");
  });
});
