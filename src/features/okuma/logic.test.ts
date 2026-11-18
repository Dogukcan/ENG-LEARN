import { describe, expect, it } from "vitest";
import type { Book, InboxItem } from "../../data";
import { bookSourceLine, capturedToday, doneMinutes, formatClock, stepValue, titleProgress } from "./logic";

const books: Book[] = [{ id: "b1", title: "Reader at Work 1", shortName: "RW1", unit: 3, page: 42 }];

function item(id: string, createdAt: string, source: InboxItem["source"], sentence?: string): InboxItem {
  return { id, word: id, createdAt, source, ...(sentence ? { sentence } : {}) };
}

describe("stepValue", () => {
  it("moves by one and never goes below 1", () => {
    expect(stepValue(42, 1)).toBe(43);
    expect(stepValue(42, -1)).toBe(41);
    expect(stepValue(1, -1)).toBe(1);
  });
});

describe("formatClock", () => {
  it("pads minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(4503)).toBe("75:03");
  });
  it("ignores negative and fractional input", () => {
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(59.9)).toBe("00:59");
  });
});

describe("doneMinutes", () => {
  it("adds the running seconds and rounds down once", () => {
    expect(doneMinutes(10, 0)).toBe(10);
    expect(doneMinutes(10.5, 29)).toBe(10);
    expect(doneMinutes(10.5, 30)).toBe(11);
    expect(doneMinutes(0, 59)).toBe(0);
  });
});

describe("titleProgress", () => {
  it("uses non-breaking spaces", () => {
    expect(titleProgress(12, 35)).toBe("12\u00A0/\u00A035\u00A0dk");
  });
});

describe("bookSourceLine", () => {
  it("shows the short name, or only the page when the book is gone", () => {
    expect(bookSourceLine({ kind: "kitap", bookId: "b1", page: 42 }, books)).toBe("RW1 · s. 42");
    expect(bookSourceLine({ kind: "kitap", bookId: "x", page: 7 }, books)).toBe("s. 7");
  });
});

describe("capturedToday", () => {
  const now = new Date(2026, 10, 18, 12, 0, 0); // local noon
  const early = new Date(2026, 10, 18, 0, 30, 0).toISOString(); // 00:30 local, still today
  const late = new Date(2026, 10, 18, 20, 0, 0).toISOString();
  const yesterday = new Date(2026, 10, 17, 23, 59, 0).toISOString();
  const tomorrow = new Date(2026, 10, 19, 0, 0, 0).toISOString();
  const kitap = { kind: "kitap", bookId: "b1", page: 42 } as const;

  it("keeps book words of the local day, newest first", () => {
    const rows = capturedToday(
      [item("a", early, kitap), item("b", late, kitap, "A sentence."), item("c", yesterday, kitap), item("d", tomorrow, kitap)],
      books,
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0]).toEqual({ id: "b", word: "b", sentence: "A sentence.", sourceLine: "RW1 · s. 42" });
  });

  it("skips words that did not come from a book", () => {
    const rows = capturedToday([item("v", late, { kind: "video" }), item("o", late, { kind: "diger" })], books, now);
    expect(rows).toEqual([]);
  });
});
