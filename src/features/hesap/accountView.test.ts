import { describe, expect, it } from "vitest";
import type { SyncState } from "../sync/engine";
import { RESEND_SECONDS, accountDot, accountPanel, isEmailShape, relativeTimeTr, resendSecondsLeft } from "./accountView";

const sync = (patch: Partial<SyncState> = {}): SyncState => ({
  status: "idle",
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
  ...patch,
});
const base = { configured: true, signedIn: true, linkSent: false, sync: sync() };

describe("accountPanel", () => {
  it("picks the view for each state", () => {
    expect(accountPanel({ ...base, configured: false })).toBe("off");
    expect(accountPanel({ ...base, signedIn: false })).toBe("out");
    expect(accountPanel({ ...base, signedIn: false, linkSent: true })).toBe("sent");
    expect(accountPanel(base)).toBe("in");
    expect(accountPanel({ ...base, sync: sync({ status: "syncing" }) })).toBe("in");
    expect(accountPanel({ ...base, sync: sync({ pendingCount: 3 }) })).toBe("pending");
    expect(accountPanel({ ...base, sync: sync({ status: "offline" }) })).toBe("pending");
    expect(accountPanel({ ...base, sync: sync({ status: "error", lastError: "x" }) })).toBe("error");
  });

  it("an error wins over pending changes", () => {
    expect(accountPanel({ ...base, sync: sync({ status: "error", pendingCount: 2 }) })).toBe("error");
  });
});

describe("accountDot", () => {
  it("says the same thing in words as the colour", () => {
    expect(accountDot({ ...base, configured: false })).toEqual({ tone: "none", label: "Hesap, bulut eşitleme kapalı" });
    expect(accountDot({ ...base, signedIn: false })).toEqual({ tone: "none", label: "Hesap" });
    expect(accountDot(base)).toEqual({ tone: "ok", label: "Hesap, eşitleme güncel" });
    expect(accountDot({ ...base, sync: sync({ pendingCount: 3 }) })).toEqual({ tone: "pending", label: "Hesap, 3 değişiklik bekliyor" });
    expect(accountDot({ ...base, sync: sync({ status: "offline" }) }).label).toBe("Hesap, çevrimdışı");
    expect(accountDot({ ...base, sync: sync({ status: "error" }) })).toEqual({ tone: "error", label: "Hesap, eşitleme hatası" });
  });
});

describe("relativeTimeTr", () => {
  const now = new Date("2026-11-17T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("formats the age", () => {
    expect(relativeTimeTr(null, now)).toBe("henüz yok");
    expect(relativeTimeTr(ago(20_000), now)).toBe("az önce");
    expect(relativeTimeTr(ago(2 * 60_000), now)).toBe("2 dk önce");
    expect(relativeTimeTr(ago(3 * 3_600_000), now)).toBe("3 saat önce");
    expect(relativeTimeTr(ago(50 * 3_600_000), now)).toBe("2 gün önce");
  });
  it("treats a time in the future as just now", () => {
    expect(relativeTimeTr(ago(-5000), now)).toBe("az önce");
  });
});

describe("resendSecondsLeft", () => {
  it("counts down from 60 to 0 and never goes below", () => {
    expect(resendSecondsLeft(1000, 1000)).toBe(RESEND_SECONDS);
    expect(resendSecondsLeft(1000, 1000 + 15_000)).toBe(45);
    expect(resendSecondsLeft(1000, 1000 + 60_000)).toBe(0);
    expect(resendSecondsLeft(1000, 1000 + 90_000)).toBe(0);
  });
});

describe("isEmailShape", () => {
  it("accepts a plain address and rejects obvious mistakes", () => {
    expect(isEmailShape(" ad@ornek.com ")).toBe(true);
    expect(isEmailShape("ad@ornek")).toBe(false);
    expect(isEmailShape("")).toBe(false);
  });
});
