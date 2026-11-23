import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const LOCAL_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://i.ytimg.com",
  "connect-src 'self' https://www.youtube.com https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

describe("buildCsp", () => {
  it("builds the specified local-only policy without a Supabase URL", () => {
    expect(buildCsp()).toBe(LOCAL_POLICY);
    expect(buildCsp("")).toBe(LOCAL_POLICY);
  });

  it("adds the Supabase origin and its secure realtime origin to connect-src", () => {
    expect(buildCsp("https://example.supabase.co")).toBe(
      LOCAL_POLICY.replace(
        "https://fonts.gstatic.com; worker-src",
        "https://fonts.gstatic.com https://example.supabase.co wss://example.supabase.co; worker-src",
      ),
    );
  });

  it("uses insecure realtime for an HTTP Supabase URL", () => {
    const policy = buildCsp("http://127.0.0.1:54321");
    expect(policy).toContain("connect-src 'self' https://www.youtube.com https://fonts.googleapis.com https://fonts.gstatic.com http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(policy).not.toContain("wss:");
  });

  it("drops credentials, paths, queries and fragments from the Supabase URL", () => {
    expect(buildCsp("https://user:placeholder@example.supabase.co/rest/v1?query=value#fragment")).toBe(
      buildCsp("https://example.supabase.co"),
    );
  });

  it.each(["not a URL", "https://", "javascript:alert(1)", "data:text/plain,example"])(
    "ignores invalid configuration: %s",
    (url) => {
      expect(buildCsp(url)).toBe(LOCAL_POLICY);
    },
  );
});
