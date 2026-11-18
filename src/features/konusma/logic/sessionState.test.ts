import { describe, expect, it } from "vitest";
import { initialStep, parseSavedSession } from "./sessionState";

const IDS = ["retell-reading", "cafe-order"];

describe("parseSavedSession", () => {
  it("reads a valid saved session", () => {
    expect(parseSavedSession('{"step":"3","scenarioId":"cafe-order"}', IDS)).toEqual({
      step: "3",
      scenarioId: "cafe-order",
    });
  });
  it("returns null for nothing, bad JSON, unknown step or unknown scenario", () => {
    expect(parseSavedSession(null, IDS)).toBeNull();
    expect(parseSavedSession("{oops", IDS)).toBeNull();
    expect(parseSavedSession('{"step":"9","scenarioId":"cafe-order"}', IDS)).toBeNull();
    expect(parseSavedSession('{"step":"2","scenarioId":"gone"}', IDS)).toBeNull();
    expect(parseSavedSession("42", IDS)).toBeNull();
  });
});

describe("initialStep", () => {
  it("starts at step 1 with nothing saved and no timer", () => {
    expect(initialStep(null, false)).toBe("1");
  });
  it("jumps to step 2 when the Konuşma timer is running", () => {
    expect(initialStep(null, true)).toBe("2");
    expect(initialStep({ step: "1", scenarioId: "cafe-order" }, true)).toBe("2");
  });
  it("keeps a saved step otherwise", () => {
    expect(initialStep({ step: "3", scenarioId: "cafe-order" }, true)).toBe("3");
    expect(initialStep({ step: "3", scenarioId: "cafe-order" }, false)).toBe("3");
  });
});
