import { describe, expect, it } from "vitest";
import { NGSL_SIZE, rankOf } from "../ngsl";

describe("rankOf", () => {
  it("knows the official list size", () => {
    expect(NGSL_SIZE).toBe(2809);
  });

  it("returns 1-based ranks in list order", () => {
    expect(rankOf("the")).toBe(1);
    expect(rankOf("be")).toBe(2);
    expect(rankOf("thirst")).toBe(NGSL_SIZE);
  });

  it("normalises case and spaces like saved words", () => {
    expect(rankOf("  The ")).toBe(1);
    expect(rankOf("BE")).toBe(2);
  });

  it("returns null for words that are not lemmas on the list", () => {
    expect(rankOf("walked")).toBeNull();
    expect(rankOf("zzyzx")).toBeNull();
    expect(rankOf("")).toBeNull();
  });
});
