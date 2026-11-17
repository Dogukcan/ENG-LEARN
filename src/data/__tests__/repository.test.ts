// `fake-indexeddb/auto` installs an in-memory IndexedDB on the global object, so the real
// repository code runs in Node exactly as it would in the browser. It must be imported first.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import { DEFAULT_SETTINGS } from "../repository";

/** Every test gets its own database name, so tests never see each other's data. */
function freshDbName(): string {
  return `eng-learn-test-${crypto.randomUUID()}`;
}

function freshRepo() {
  return createIndexedDbRepository(freshDbName());
}

/** ISO string for a local date and time (month is 1-based here for readability). */
function localIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

describe("seeding", () => {
  it("creates the two Reader at Work books on first open", async () => {
    const repo = freshRepo();
    const books = await repo.books.list();

    expect(books.map((b) => [b.title, b.shortName, b.unit, b.page])).toEqual([
      ["Reader at Work 1", "RW1", 1, 1],
      ["Reader at Work 2", "RW2", 1, 1],
    ]);
    for (const book of books) {
      expect(book.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("does not seed again when the same database is opened later", async () => {
    const name = freshDbName();
    const first = await createIndexedDbRepository(name).books.list();
    const second = await createIndexedDbRepository(name).books.list();

    expect(second).toHaveLength(2);
    expect(second.map((b) => b.id)).toEqual(first.map((b) => b.id));
  });
});

describe("books", () => {
  it("setPosition moves the bookmark and returns undefined for an unknown id", async () => {
    const repo = freshRepo();
    const [rw1] = await repo.books.list();
    if (!rw1) throw new Error("seed missing");

    const updated = await repo.books.setPosition(rw1.id, { unit: 3, page: 42 });
    expect(updated).toEqual({ ...rw1, unit: 3, page: 42 });
    expect(await repo.books.get(rw1.id)).toEqual(updated);
    expect(await repo.books.setPosition("no-such-id", { unit: 1, page: 1 })).toBeUndefined();
  });
});

describe("inbox", () => {
  it("adds a word with trimmed text and keeps its source", async () => {
    const repo = freshRepo();
    const result = await repo.inbox.add({
      word: "  resilient ",
      sentence: " She is resilient. ",
      meaningTr: "   ",
      source: { kind: "video", label: "TED" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.word).toBe("resilient");
    expect(result.item.sentence).toBe("She is resilient.");
    expect(result.item.meaningTr).toBeUndefined();
    expect(result.item.source).toEqual({ kind: "video", label: "TED" });
    expect(await repo.inbox.list()).toEqual([result.item]);
  });

  it("rejects an empty or whitespace-only word", async () => {
    const repo = freshRepo();
    expect(await repo.inbox.add({ word: "", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(await repo.inbox.add({ word: "   ", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(await repo.inbox.list()).toEqual([]);
  });

  it("rejects duplicates ignoring case and outer spaces", async () => {
    const repo = freshRepo();
    const first = await repo.inbox.add({ word: "Apple", source: { kind: "diger" } });
    expect(first.ok).toBe(true);

    expect(await repo.inbox.add({ word: "apple", source: { kind: "konusma" } })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await repo.inbox.add({ word: "  APPLE  ", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await repo.inbox.list()).toHaveLength(1);
  });

  it("restore puts a removed item back exactly as it was", async () => {
    const repo = freshRepo();
    const [rw1] = await repo.books.list();
    if (!rw1) throw new Error("seed missing");
    const added = await repo.inbox.add({
      word: "borrow",
      sentence: "Can I borrow your pen?",
      source: { kind: "kitap", bookId: rw1.id, page: 12 },
    });
    if (!added.ok) throw new Error("add failed");

    const removed = await repo.inbox.remove(added.item.id);
    expect(removed).toEqual(added.item);
    expect(await repo.inbox.list()).toEqual([]);

    expect(await repo.inbox.restore(added.item)).toEqual({ ok: true, item: added.item });
    expect(await repo.inbox.list()).toEqual([added.item]);
  });
});

describe("triage", () => {
  it("moves an inbox item to words with the chosen status", async () => {
    const repo = freshRepo();
    const added = await repo.inbox.add({
      word: "Thrive",
      meaningTr: "gelişmek",
      sentence: "Plants thrive in sun.",
      source: { kind: "konusma" },
    });
    if (!added.ok) throw new Error("add failed");

    const result = await repo.words.triage(added.item.id, "learning");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.word).toMatchObject({
      lemma: "Thrive",
      status: "learning",
      meaningTr: "gelişmek",
      sentence: "Plants thrive in sun.",
      source: { kind: "konusma" },
    });

    // Both sides of the move are visible together: gone from the inbox, present in words.
    expect(await repo.inbox.list()).toEqual([]);
    expect(await repo.words.listByStatus("learning")).toEqual([result.word]);
    expect(await repo.words.listByStatus("known")).toEqual([]);
  });

  it("returns not-found for an unknown item and changes nothing", async () => {
    const repo = freshRepo();
    const added = await repo.inbox.add({ word: "keep", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");

    expect(await repo.words.triage("no-such-id", "known")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await repo.inbox.list()).toEqual([added.item]);
    expect(await repo.words.listByStatus("known")).toEqual([]);
  });

  it("treats a word that was already sorted as a duplicate when captured again", async () => {
    const repo = freshRepo();
    const added = await repo.inbox.add({ word: "light", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");
    await repo.words.triage(added.item.id, "known");

    expect(await repo.inbox.add({ word: " Light", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("activity", () => {
  it("sums minutes per block for one local day and ignores other days", async () => {
    const repo = freshRepo();
    const add = (block: "okuma" | "kelime" | "dinleme" | "konusma", startedAt: string, seconds: number) =>
      repo.activity.add({ block, startedAt, seconds, source: "timer" });

    await add("okuma", localIso(2026, 11, 17, 10, 0), 600);
    await add("okuma", localIso(2026, 11, 17, 14, 30), 900);
    await add("kelime", localIso(2026, 11, 17, 0, 0), 300); // exactly local midnight: included
    await add("konusma", localIso(2026, 11, 17, 23, 59, 59), 120);
    await add("dinleme", localIso(2026, 11, 16, 23, 59), 1200); // previous day: ignored
    await add("konusma", localIso(2026, 11, 18, 0, 0), 600); // next local midnight: ignored

    expect(await repo.activity.minutesPerBlockForDay("2026-11-17")).toEqual({
      okuma: 25,
      kelime: 5,
      dinleme: 0,
      konusma: 2,
    });
  });

  it("listForDay returns only that day's sessions, oldest first", async () => {
    const repo = freshRepo();
    const late = await repo.activity.add({
      block: "dinleme",
      startedAt: localIso(2026, 11, 17, 20, 0),
      seconds: 60,
      source: "manual",
    });
    const early = await repo.activity.add({
      block: "okuma",
      startedAt: localIso(2026, 11, 17, 8, 0),
      seconds: 60,
      source: "timer",
    });
    await repo.activity.add({
      block: "okuma",
      startedAt: localIso(2026, 11, 18, 8, 0),
      seconds: 60,
      source: "timer",
    });

    expect(await repo.activity.listForDay("2026-11-17")).toEqual([early, late]);
  });
});

describe("settings", () => {
  it("returns the defaults before anything is saved", async () => {
    const repo = freshRepo();
    expect(await repo.settings.get()).toEqual({
      dailyMinimumMinutes: 20,
      dailyTargetMinutes: 95,
      blockPlanMinutes: { okuma: 35, kelime: 15, dinleme: 25, konusma: 20 },
      newCardLimit: 10,
      activeBookId: null,
    });
    expect(await repo.settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("update merges a partial change and persists it", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    const [rw2] = (await repo.books.list()).slice(1);
    if (!rw2) throw new Error("seed missing");

    const updated = await repo.settings.update({
      dailyTargetMinutes: 60,
      blockPlanMinutes: { dinleme: 10 },
      activeBookId: rw2.id,
    });
    const expected = {
      ...DEFAULT_SETTINGS,
      dailyTargetMinutes: 60,
      blockPlanMinutes: { okuma: 35, kelime: 15, dinleme: 10, konusma: 20 },
      activeBookId: rw2.id,
    };
    expect(updated).toEqual(expected);

    // A second repository on the same database reads the saved values back.
    expect(await createIndexedDbRepository(name).settings.get()).toEqual(expected);

    // `undefined` means "unchanged"; `null` really clears the active book.
    expect(await repo.settings.update({ dailyTargetMinutes: undefined, activeBookId: null })).toEqual({
      ...expected,
      activeBookId: null,
    });
  });
});
