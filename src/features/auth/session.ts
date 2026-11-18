// Thin, typed wrappers around Supabase Auth. No UI here.
//
// Every function returns a result object instead of throwing, so the UI can show a message
// without try/catch, and so "Supabase is not configured" is a normal, testable outcome.
import type { Session } from "@supabase/supabase-js";
import { supabase as defaultClient } from "../../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: "not-configured" | "invalid-email" | "invalid-code" | "error"; message: string };

const NOT_CONFIGURED = {
  ok: false,
  reason: "not-configured",
  message: "Supabase ayarlanmamış. .env.local dosyasını kontrol et.",
} as const;

// A light check only; the real validation is done by Supabase.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The code in the mail is 6 digits (Supabase default). Spaces are allowed: people type "123 456". */
const CODE_PATTERN = /^\d{6}$/;
export const normalizeCode = (value: string): string => value.replace(/\s+/g, "");
export const isCodeShape = (value: string): boolean => CODE_PATTERN.test(normalizeCode(value));

/**
 * Send a one-time sign-in code (and, as a second way, a link) by email.
 * `shouldCreateUser: false` means a stranger cannot create an account this way: only the
 * user created by hand in the dashboard can sign in.
 * `client` is a parameter (default: the real one) so tests can pass null or a fake.
 */
export async function signInWithEmail(
  email: string,
  client: SupabaseClient | null = defaultClient,
): Promise<AuthResult> {
  if (!client) return NOT_CONFIGURED;
  const trimmed = email.trim();
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, reason: "invalid-email", message: "E-posta adresi geçerli değil." };
  }
  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, value: undefined };
}

/**
 * Finish the sign-in with the 6-digit code from the mail (type "email").
 * Why a code and not only the link: on an iPhone the home-screen app has its own storage, separate
 * from Safari. The link in the mail always opens in Safari, so the session would end up there and
 * never in the app. Typing the code inside the app signs in the app itself.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  client: SupabaseClient | null = defaultClient,
): Promise<AuthResult> {
  if (!client) return NOT_CONFIGURED;
  if (!isCodeShape(code)) {
    return { ok: false, reason: "invalid-code", message: "Kod 6 haneli olmalı." };
  }
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token: normalizeCode(code), type: "email" });
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, value: undefined };
}

export async function signOut(client: SupabaseClient | null = defaultClient): Promise<AuthResult> {
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.signOut();
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, value: undefined };
}

/** The current session, or null when signed out. */
export async function getSession(
  client: SupabaseClient | null = defaultClient,
): Promise<AuthResult<Session | null>> {
  if (!client) return NOT_CONFIGURED;
  const { data, error } = await client.auth.getSession();
  if (error) return { ok: false, reason: "error", message: error.message };
  return { ok: true, value: data.session };
}

/**
 * Subscribe to sign-in / sign-out changes. Returns an unsubscribe function.
 * When not configured nothing can change, so it returns a no-op.
 */
export function onAuthChange(
  callback: (session: Session | null) => void,
  client: SupabaseClient | null = defaultClient,
): () => void {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
