// What the Konuşma screen remembers across a page reload: the chosen step, the scenario and the
// report text that was pasted but not processed yet.
//
// Why: the learner leaves for ChatGPT or Gemini during a long voice chat. iOS may drop the PWA from
// memory meanwhile; on return the screen would start at step 1 with the first scenario and an empty
// report box while the timer (kept in localStorage) is still running. sessionStorage is enough: it
// survives a reload and does not keep a stale draft forever. Every access is wrapped because storage
// can throw (private mode, blocked site data).
//
// localStorage, not sessionStorage: a home-screen PWA that iOS kills loses its sessionStorage, so the
// state must live in localStorage. Because localStorage never clears itself, the saved step and
// scenario carry a timestamp and are dropped after 12 hours; otherwise a talk from yesterday would
// reopen at step 3. The report draft has no expiry: it is cleared after a successful save.

export type Step = "1" | "2" | "3";

export interface SavedSession {
  step: Step;
  scenarioId: string;
}

export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SESSION_KEY = "eng-learn:konusma-session";
const REPORT_KEY = "eng-learn:konusma-report-draft";

const STEPS: readonly Step[] = ["1", "2", "3"];

/** Read what storage returned; anything odd (bad JSON, unknown step or scenario) means "nothing saved". */
export function parseSavedSession(
  raw: string | null,
  validScenarioIds: readonly string[],
  now: number = Date.now(),
): SavedSession | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { step, scenarioId, savedAt } = value as Record<string, unknown>;
  // A missing or future timestamp (clock change) is treated as expired: better to start fresh.
  if (typeof savedAt !== "number" || savedAt > now || now - savedAt > SESSION_MAX_AGE_MS) return null;
  if (typeof step !== "string" || !STEPS.includes(step as Step)) return null;
  if (typeof scenarioId !== "string" || !validScenarioIds.includes(scenarioId)) return null;
  return { step: step as Step, scenarioId };
}

/**
 * The step to open with. A saved step wins, except that a running Konuşma timer means the learner is
 * in the middle of the talk, so "1 Hazırlan" is replaced by "2 Konuş" (where the Durdur button is).
 */
export function initialStep(saved: SavedSession | null, konusmaTimerRunning: boolean): Step {
  const step = saved?.step ?? "1";
  return step === "1" && konusmaTimerRunning ? "2" : step;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSavedSession(validScenarioIds: readonly string[]): SavedSession | null {
  try {
    return parseSavedSession(storage()?.getItem(SESSION_KEY) ?? null, validScenarioIds);
  } catch {
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    // Without storage the screen still works; it just will not survive a reload.
  }
}

export function loadReportDraft(): string {
  try {
    return storage()?.getItem(REPORT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** An empty text removes the draft, so a cleared box does not bring old text back. */
export function saveReportDraft(text: string): void {
  try {
    if (text === "") storage()?.removeItem(REPORT_KEY);
    else storage()?.setItem(REPORT_KEY, text);
  } catch {
    // Best effort, see above.
  }
}
