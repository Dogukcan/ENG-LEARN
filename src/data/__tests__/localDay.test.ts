import { describe, expect, it } from "vitest";
import { localDayRange, toLocalDay } from "../localDay";

// These tests build dates with `new Date(year, monthIndex, day, ...)`, which means local time,
// so they pass in any device time zone (Türkiye or the CI machine's).

describe("local day helpers", () => {
  it("toLocalDay formats the local calendar day as YYYY-MM-DD", () => {
    expect(toLocalDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(toLocalDay(new Date(2026, 10, 17, 0, 0))).toBe("2026-11-17");
  });

  it("localDayRange spans exactly one local day as UTC ISO strings", () => {
    expect(localDayRange("2026-11-17")).toEqual({
      start: new Date(2026, 10, 17).toISOString(),
      end: new Date(2026, 10, 18).toISOString(),
    });
    // Month and year roll over correctly.
    expect(localDayRange("2026-12-31").end).toBe(new Date(2027, 0, 1).toISOString());
  });

  it("localDayRange rejects text that is not a real date", () => {
    expect(() => localDayRange("17.11.2026")).toThrow(RangeError);
    expect(() => localDayRange("2026-13-01")).toThrow(RangeError);
    expect(() => localDayRange("2026-02-30")).toThrow(RangeError);
  });
});
