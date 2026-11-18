import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession, isCodeShape, onAuthChange, signInWithEmail, signOut, verifyEmailCode } from "./session";

// These tests pass `null` as the client: that is the "not configured" path, with no network.
describe("auth session without Supabase configured", () => {
  it("signInWithEmail reports not-configured", async () => {
    const result = await signInWithEmail("a@b.com", null);
    expect(result).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("signOut reports not-configured", async () => {
    expect(await signOut(null)).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("getSession reports not-configured", async () => {
    expect(await getSession(null)).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("onAuthChange returns a harmless unsubscribe and never calls back", () => {
    const callback = vi.fn();
    const unsubscribe = onAuthChange(callback, null);
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("verifyEmailCode", () => {
  const fakeClient = (error: { message: string } | null = null) => {
    const verifyOtp = vi.fn(async () => ({ error }));
    return { client: { auth: { verifyOtp } } as unknown as SupabaseClient, verifyOtp };
  };

  it("reports not-configured without a client", async () => {
    expect(await verifyEmailCode("a@b.com", "123456", null)).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("accepts exactly 6 digits, with or without spaces", () => {
    expect(isCodeShape("123456")).toBe(true);
    expect(isCodeShape(" 123 456 ")).toBe(true);
    expect(isCodeShape("12345")).toBe(false);
    expect(isCodeShape("1234567")).toBe(false);
    expect(isCodeShape("12a456")).toBe(false);
  });

  it("does not call Supabase for a code of the wrong shape", async () => {
    const { client, verifyOtp } = fakeClient();
    expect(await verifyEmailCode("a@b.com", "12", client)).toMatchObject({ ok: false, reason: "invalid-code" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('calls verifyOtp with type "email", the trimmed address and the code without spaces', async () => {
    const { client, verifyOtp } = fakeClient();
    expect(await verifyEmailCode(" a@b.com ", "123 456", client)).toEqual({ ok: true, value: undefined });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@b.com", token: "123456", type: "email" });
  });

  it("returns the server's message when the code is wrong or expired", async () => {
    const { client } = fakeClient({ message: "Token has expired or is invalid" });
    expect(await verifyEmailCode("a@b.com", "123456", client)).toMatchObject({ ok: false, reason: "error", message: "Token has expired or is invalid" });
  });
});
