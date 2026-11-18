import { useEffect } from "react";
import { startWakeReload } from "./wakeReload";

/**
 * Call `reload` (from useRepoData) when the page becomes visible again and once a minute while it is
 * open, so "today", the 7-day strip and the due-card count follow the clock across midnight.
 */
export function useReloadOnWake(reload: () => void): void {
  useEffect(
    () =>
      startWakeReload(reload, {
        doc: document,
        setIntervalFn: (handler, ms) => window.setInterval(handler, ms),
        clearIntervalFn: (id) => window.clearInterval(id),
      }),
    [reload],
  );
}
