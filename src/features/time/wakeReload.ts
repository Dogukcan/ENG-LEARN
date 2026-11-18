// Reload helper for screens that compute "today" and "due now" at load time.
//
// Why this exists: useRepoData only reloads after a repository write. An iPhone PWA is usually kept
// in memory, so after midnight (or after a night in the background) a screen would keep showing
// yesterday's minutes and an old due-card count until the user wrote something. This starts a
// reload on two triggers: the page becoming visible, and a slow interval while it stays open.
// It is plain functions with injected browser objects so it can be tested in Node.

export const WAKE_RELOAD_INTERVAL_MS = 60_000;

export interface WakeDocument {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface WakeEnv {
  doc: WakeDocument;
  setIntervalFn: (handler: () => void, ms: number) => number;
  clearIntervalFn: (id: number) => void;
}

/** Start the two triggers. Returns a function that stops them. */
export function startWakeReload(reload: () => void, env: WakeEnv): () => void {
  const interval = env.setIntervalFn(() => {
    // A hidden tab is throttled and nobody looks at it; the visible trigger will catch up.
    if (env.doc.visibilityState === "visible") reload();
  }, WAKE_RELOAD_INTERVAL_MS);
  const onVisibility = () => {
    if (env.doc.visibilityState === "visible") reload();
  };
  env.doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    env.clearIntervalFn(interval);
    env.doc.removeEventListener("visibilitychange", onVisibility);
  };
}
