import { describe, expect, it } from "vitest";
import { WAKE_RELOAD_INTERVAL_MS, startWakeReload } from "./wakeReload";
import type { WakeEnv } from "./wakeReload";

function fakeEnv() {
  const listeners: Array<() => void> = [];
  let tick: (() => void) | null = null;
  let intervalMs = 0;
  let cleared = false;
  const doc = {
    visibilityState: "visible",
    addEventListener: (_type: "visibilitychange", listener: () => void) => void listeners.push(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const env: WakeEnv = {
    doc,
    setIntervalFn: (handler, ms) => {
      tick = handler;
      intervalMs = ms;
      return 7;
    },
    clearIntervalFn: (id) => {
      cleared = id === 7;
    },
  };
  return {
    env,
    doc,
    fireVisibility: () => listeners.forEach((listener) => listener()),
    fireTick: () => tick?.(),
    state: () => ({ intervalMs, cleared, listenerCount: listeners.length }),
  };
}

describe("startWakeReload", () => {
  it("reloads when the page becomes visible", () => {
    const fake = fakeEnv();
    let reloads = 0;
    startWakeReload(() => reloads++, fake.env);
    fake.doc.visibilityState = "hidden";
    fake.fireVisibility();
    expect(reloads).toBe(0);
    fake.doc.visibilityState = "visible";
    fake.fireVisibility();
    expect(reloads).toBe(1);
  });

  it("reloads on the interval only while visible", () => {
    const fake = fakeEnv();
    let reloads = 0;
    startWakeReload(() => reloads++, fake.env);
    expect(fake.state().intervalMs).toBe(WAKE_RELOAD_INTERVAL_MS);
    fake.fireTick();
    fake.doc.visibilityState = "hidden";
    fake.fireTick();
    expect(reloads).toBe(1);
  });

  it("stops both triggers on cleanup", () => {
    const fake = fakeEnv();
    const stop = startWakeReload(() => undefined, fake.env);
    expect(fake.state().listenerCount).toBe(1);
    stop();
    expect(fake.state()).toMatchObject({ cleared: true, listenerCount: 0 });
  });
});
