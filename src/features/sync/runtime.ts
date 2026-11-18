// The app-wide sync engine and the signed-in user, wired to the real repository and Supabase.
//
// Why a module-level singleton: sync must run for the whole life of the page, not only while a
// screen is mounted. The Bugün screen imports this file, and Bugün is where the app starts, so
// the engine starts with the app. (If a screen other than Bugün ever becomes the entry point,
// import this file from main.tsx too.)

import { repository } from "../../data";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { getSession, onAuthChange } from "../auth/session";
import { createSyncEngine } from "./engine";
import type { SyncClient } from "./engine";

// The real client has far more methods than the engine uses; this is the one place where we say
// "the part we use matches SyncClient". Tests pass a plain fake instead.
export const syncEngine = createSyncEngine({
  repo: repository,
  client: supabase as unknown as SyncClient | null,
  now: () => new Date(),
});

export interface AccountSnapshot {
  configured: boolean;
  /** False until the first session lookup finished, so the UI does not flash "signed out". */
  ready: boolean;
  signedIn: boolean;
  email: string | null;
}

let account: AccountSnapshot = { configured: isSupabaseConfigured, ready: !isSupabaseConfigured, signedIn: false, email: null };
const accountListeners = new Set<() => void>();

function setAccount(next: AccountSnapshot): void {
  account = next;
  for (const listener of accountListeners) listener();
}

export const getAccountSnapshot = (): AccountSnapshot => account;
export function subscribeAccount(listener: () => void): () => void {
  accountListeners.add(listener);
  return () => accountListeners.delete(listener);
}

let started = false;
/** Starts the triggers and follows sign-in / sign-out. Safe to call many times. */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  syncEngine.start();
  if (!isSupabaseConfigured) return;
  const apply = (session: { user: { id: string; email?: string } } | null): void => {
    syncEngine.setUser(session?.user.id ?? null);
    setAccount({ configured: true, ready: true, signedIn: session !== null, email: session?.user.email ?? null });
  };
  void getSession().then((result) => apply(result.ok ? result.value : null));
  onAuthChange(apply);
}

startSync();
