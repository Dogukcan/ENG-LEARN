import { afterEach, describe, expect, it, vi } from "vitest";
import { initialStep, parseSavedSession, SESSION_MAX_AGE_MS } from "./sessionState";

const IDS = ["retell-reading", "cafe-order"];
const NOW = 1_700_000_000_000;
const raw = (step: string, scenarioId: string, savedAt: number) => JSON.stringify({ step, scenarioId, savedAt });

describe("parseSavedSession", () => {
  it("reads a valid saved session", () => {
    expect(parseSavedSession(raw("3", "cafe-order", NOW - 1000), IDS, NOW)).toEqual({
      step: "3",
      scenarioId: "cafe-order",
    });
  });
  it("returns null for nothing, bad JSON, unknown step or unknown scenario", () => {
    expect(parseSavedSession(null, IDS)).toBeNull();
    expect(parseSavedSession("{oops", IDS)).toBeNull();
    expect(parseSavedSession(raw("9", "cafe-order", NOW), IDS, NOW)).toBeNull();
    expect(parseSavedSession(raw("2", "gone", NOW), IDS, NOW)).toBeNull();
    expect(parseSavedSession("42", IDS)).toBeNull();
  });
});

describe("parseSavedSession expiry", () => {
  it("keeps a session just under 12 hours old", () => {
    expect(parseSavedSession(raw("2", "cafe-order", NOW - SESSION_MAX_AGE_MS), IDS, NOW)).not.toBeNull();
  });
  it("drops a session older than 12 hours", () => {
    expect(parseSavedSession(raw("2", "cafe-order", NOW - SESSION_MAX_AGE_MS - 1), IDS, NOW)).toBeNull();
  });
  it("drops a session with no timestamp or a timestamp in the future", () => {
    expect(parseSavedSession('{"step":"2","scenarioId":"cafe-order"}', IDS, NOW)).toBeNull();
    expect(parseSavedSession(raw("2", "cafe-order", NOW + 5000), IDS, NOW)).toBeNull();
  });
});

describe("localStorage round trip", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("saves into localStorage, not sessionStorage, and reads it back", async () => {
    // The test environment is node, so a tiny in-memory Storage stands in for the browser ones.
    const fake = (): Storage => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      } as unknown as Storage;
    };
    vi.stubGlobal("window", { localStorage: fake(), sessionStorage: fake() });
    const mod = await import("./sessionState");
    mod.saveSession({ step: "3", scenarioId: "cafe-order" });
    expect(window.localStorage.getItem("eng-learn:konusma-session")).not.toBeNull();
    expect(window.sessionStorage.getItem("eng-learn:konusma-session")).toBeNull();
    expect(mod.loadSavedSession(IDS)).toEqual({ step: "3", scenarioId: "cafe-order" });
    mod.saveReportDraft("draft");
    expect(window.localStorage.getItem("eng-learn:konusma-report-draft")).toBe("draft");
    mod.saveReportDraft("");
    expect(window.localStorage.getItem("eng-learn:konusma-report-draft")).toBeNull();
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
