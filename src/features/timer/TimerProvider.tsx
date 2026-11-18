// The one timer for the whole app.
//
// Rules (shared contract with the Bugün and Okuma screens):
// - Only one block runs at a time. Starting another block first stops (and records) the running one.
// - Stopping writes an activity log of whole minutes (at least 1), or nothing for 0 seconds.
// - The running timer survives a page reload: `{ block, startedAt }` is kept in localStorage and
//   elapsed time is always "now minus startedAt", never a tick counter.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { repository } from "../../data";
import type { SkillBlock } from "../../data";
import { elapsedSecondsSince, parsePersistedTimer, secondsToRecord } from "./timerMath";
import type { PersistedTimer } from "./timerMath";

const STORAGE_KEY = "eng-learn:running-timer";

export interface TimerApi {
  /** The block that is running now, or null. */
  running: SkillBlock | null;
  /** Seconds since the timer started; 0 when nothing runs. Updates once per second. */
  elapsedSeconds: number;
  start(block: SkillBlock): Promise<void>;
  stop(): Promise<void>;
  /** Stop if this block is running, otherwise start it (stopping any other block first). */
  toggle(block: SkillBlock): Promise<void>;
}

// localStorage can throw (private mode, blocked site data), so every access is wrapped.
function readStored(): PersistedTimer | null {
  try {
    return parsePersistedTimer(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(timer: PersistedTimer | null): void {
  try {
    if (timer) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the timer still works; it just will not survive a reload.
  }
}

const TimerContext = createContext<TimerApi | null>(null);

export function TimerProvider({ children }: { children: ReactNode }) {
  // Lazy initial state: the saved timer is restored before the first paint, so there is no
  // flash of "not running" after a reload.
  const [current, setCurrent] = useState<PersistedTimer | null>(readStored);
  const [now, setNow] = useState(() => Date.now());

  // The ref is the truth for the actions: two quick taps must not both see a stale `current`
  // from the same render and write the same session twice.
  const currentRef = useRef<PersistedTimer | null>(current);

  const setTimer = useCallback((timer: PersistedTimer | null) => {
    currentRef.current = timer;
    setCurrent(timer);
    writeStored(timer);
  }, []);

  const isRunning = current !== null;
  useEffect(() => {
    if (!isRunning) return;
    const refresh = () => setNow(Date.now());
    const id = window.setInterval(refresh, 1000);
    // Timers are throttled in background tabs, so refresh at once when the tab comes back.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isRunning]);

  const stop = useCallback(async () => {
    const stopped = currentRef.current;
    if (!stopped) return;
    // Clear first (synchronously), write second: a second stop() call finds nothing to stop.
    setTimer(null);
    const seconds = secondsToRecord(elapsedSecondsSince(stopped.startedAt, Date.now()));
    if (seconds === 0) return;
    try {
      await repository.activity.add({
        block: stopped.block,
        startedAt: stopped.startedAt,
        seconds,
        source: "timer",
      });
    } catch (failure) {
      // The write failed: put the timer back so the minutes are not lost, then tell the caller.
      if (currentRef.current === null) setTimer(stopped);
      throw failure;
    }
  }, [setTimer]);

  const start = useCallback(
    async (block: SkillBlock) => {
      if (currentRef.current?.block === block) return;
      if (currentRef.current) await stop();
      setNow(Date.now());
      setTimer({ block, startedAt: new Date().toISOString() });
    },
    [stop, setTimer],
  );

  const toggle = useCallback(
    async (block: SkillBlock) => {
      if (currentRef.current?.block === block) await stop();
      else await start(block);
    },
    [start, stop],
  );

  const value = useMemo<TimerApi>(
    () => ({
      running: current ? current.block : null,
      elapsedSeconds: current ? elapsedSecondsSince(current.startedAt, now) : 0,
      start,
      stop,
      toggle,
    }),
    [current, now, start, stop, toggle],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

// The contract puts the hook in this file next to the provider, so the fast-refresh rule is switched off here.
// oxlint-disable-next-line react/only-export-components
export function useTimer(): TimerApi {
  const api = useContext(TimerContext);
  if (!api) throw new Error("useTimer must be used inside <TimerProvider>");
  return api;
}
