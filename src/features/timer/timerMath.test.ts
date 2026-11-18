import { describe, expect, it } from "vitest";
import { elapsedSecondsSince, formatMMSS, parsePersistedTimer, secondsToRecord } from "./timerMath";

describe("secondsToRecord", () => {
  it("records nothing for 0 seconds", () => {
    expect(secondsToRecord(0)).toBe(0);
  });
  it("records one full minute for a very short session", () => {
    expect(secondsToRecord(1)).toBe(60);
    expect(secondsToRecord(29)).toBe(60);
    expect(secondsToRecord(59)).toBe(60);
  });
  it("rounds to whole minutes", () => {
    expect(secondsToRecord(89)).toBe(60);
    expect(secondsToRecord(90)).toBe(120);
    expect(secondsToRecord(25 * 60 + 20)).toBe(25 * 60);
  });
  it("ignores negative input", () => {
    expect(secondsToRecord(-5)).toBe(0);
  });
});

describe("elapsedSecondsSince", () => {
  const start = "2026-11-18T10:00:00.000Z";
  const startMs = new Date(start).getTime();
  it("counts whole seconds from the start time", () => {
    expect(elapsedSecondsSince(start, startMs + 61_900)).toBe(61);
  });
  it("never goes negative when the clock moved back", () => {
    expect(elapsedSecondsSince(start, startMs - 10_000)).toBe(0);
  });
  it("returns 0 for an invalid date", () => {
    expect(elapsedSecondsSince("nope", Date.now())).toBe(0);
  });
});

describe("formatMMSS", () => {
  it("pads minutes and seconds", () => {
    expect(formatMMSS(0)).toBe("00:00");
    expect(formatMMSS(65)).toBe("01:05");
    expect(formatMMSS(75 * 60)).toBe("75:00");
  });
});

describe("parsePersistedTimer", () => {
  it("accepts a valid saved timer", () => {
    const raw = JSON.stringify({ block: "okuma", startedAt: "2026-11-18T10:00:00.000Z" });
    expect(parsePersistedTimer(raw)).toEqual({ block: "okuma", startedAt: "2026-11-18T10:00:00.000Z" });
  });
  it("rejects broken values", () => {
    expect(parsePersistedTimer(null)).toBeNull();
    expect(parsePersistedTimer("{oops")).toBeNull();
    expect(parsePersistedTimer(JSON.stringify({ block: "x", startedAt: "2026-11-18T10:00:00Z" }))).toBeNull();
    expect(parsePersistedTimer(JSON.stringify({ block: "okuma", startedAt: "bad" }))).toBeNull();
    expect(parsePersistedTimer("42")).toBeNull();
  });
});
