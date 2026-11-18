// Pure rules for the account button and sheet: which view to show, which dot colour, and the
// small Turkish texts. Kept out of the component so they can be tested without a browser.

import type { SyncState } from "../sync/engine";

export type DotTone = "none" | "ok" | "pending" | "error";

/** The views of hesap.html, variant 1, plus "switch" (another account's data is on this device). */
export type AccountPanel = "off" | "out" | "sent" | "in" | "pending" | "error" | "switch";

export interface AccountInput {
  /** Supabase keys exist in this build. */
  configured: boolean;
  signedIn: boolean;
  /** A sign-in code (and link) was sent from this device and the user has not come back yet. */
  linkSent: boolean;
  sync: SyncState;
}

export const RESEND_SECONDS = 60;

export function accountPanel(input: AccountInput): AccountPanel {
  if (!input.configured) return "off";
  if (!input.signedIn) return input.linkSent ? "sent" : "out";
  // Another account's data is on this device: sync waits for the user's answer.
  if (input.sync.foreignData) return "switch";
  const { status, pendingCount } = input.sync;
  if (status === "error") return "error";
  // Offline always counts as "waiting": changes stay on this device until the connection is back.
  if (status === "offline" || pendingCount > 0) return "pending";
  return "in";
}

/**
 * The little dot on the round button, and the button's accessible name.
 * The name says the same thing in words, so colour is never the only signal.
 */
export function accountDot(input: AccountInput): { tone: DotTone; label: string } {
  const panel = accountPanel(input);
  switch (panel) {
    case "off":
      return { tone: "none", label: "Hesap, bulut eşitleme kapalı" };
    case "out":
    case "sent":
      return { tone: "none", label: "Hesap" };
    case "error":
      return { tone: "error", label: "Hesap, eşitleme hatası" };
    case "switch":
      return { tone: "pending", label: "Hesap, başka hesabın verisi var" };
    case "pending":
      return {
        tone: "pending",
        label:
          input.sync.pendingCount > 0
            ? `Hesap, ${input.sync.pendingCount} değişiklik bekliyor`
            : "Hesap, çevrimdışı",
      };
    case "in":
      return { tone: "ok", label: "Hesap, eşitleme güncel" };
  }
}

/** "az önce", "2 dk önce", "3 saat önce", "2 gün önce". `null` means it never happened. */
export function relativeTimeTr(iso: string | null, now: Date): string {
  if (!iso) return "henüz yok";
  const diffMs = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "henüz yok";
  const minutes = Math.floor(Math.max(0, diffMs) / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

/** Seconds until the "Tekrar gönder" button works again. 0 means it is ready. */
export function resendSecondsLeft(sentAtMs: number, nowMs: number): number {
  const left = RESEND_SECONDS - Math.floor((nowMs - sentAtMs) / 1000);
  return Math.min(RESEND_SECONDS, Math.max(0, left));
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmailShape = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

/** Six digits only: strips everything else and cuts at 6, so a pasted "123 456" works. */
export const cleanCodeInput = (value: string): string => value.replace(/\D/g, "").slice(0, 6);
