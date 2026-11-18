import { describe, expect, it, vi } from "vitest";
import { getSession, onAuthChange, signInWithEmail, signOut } from "./session";

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
