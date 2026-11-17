import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * True when the user asked the OS to reduce motion.
 *
 * Why useSyncExternalStore: the value lives OUTSIDE React (in the browser's media query).
 * This hook is React's official way to read such a value and re-render when it changes,
 * without a useEffect + useState pair that can briefly show a stale value.
 * CSS transitions are already neutralised globally in index.css; this hook exists for
 * motion that is driven from JavaScript (for example the Sheet's Web Animations call).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
