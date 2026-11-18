import { describe, expect, it } from "vitest";
import { MAX_TIMER_SECONDS } from "../timer/timerMath";
import { addHiddenTime, reviewSessionMinutes } from "./reviewMinutes";

const MIN = 60_000;

describe("reviewSessionMinutes", () => {
  it("is 0 when no card was graded", () => {
    expect(reviewSessionMinutes({ startedAtMs: 0, endedAtMs: 10 * MIN, hiddenMs: 0, reviewed: 0 })).toBe(0);
  });
  it("rounds to whole minutes, at least 1", () => {
    expect(reviewSessionMinutes({ startedAtMs: 0, endedAtMs: 10 * MIN, hiddenMs: 0, reviewed: 5 })).toBe(10);
    expect(reviewSessionMinutes({ startedAtMs: 0, endedAtMs: 5_000, hiddenMs: 0, reviewed: 1 })).toBe(1);
  });
  it("drops the time the page was hidden", () => {
    expect(reviewSessionMinutes({ startedAtMs: 0, endedAtMs: 600 * MIN, hiddenMs: 590 * MIN, reviewed: 3 })).toBe(10);
  });
  it("never records more than the timer cap", () => {
    const minutes = reviewSessionMinutes({ startedAtMs: 0, endedAtMs: 900 * MIN, hiddenMs: 0, reviewed: 3 });
    expect(minutes).toBe(MAX_TIMER_SECONDS / 60);
  });
});

describe("addHiddenTime", () => {
  it("adds the hidden stretch", () => {
    expect(addHiddenTime(0, 100, 400, 0)).toBe(300);
  });
  it("ignores the part before the session started", () => {
    expect(addHiddenTime(50, 100, 400, 200)).toBe(250);
  });
});
