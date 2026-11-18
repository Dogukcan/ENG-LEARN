import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import type { SpeakingReport } from "../types";

const freshName = () => `eng-learn-speaking-test-${crypto.randomUUID()}`;

const report = (over: Partial<SpeakingReport> = {}): SpeakingReport => ({
  errors: [
    { original: "I go yesterday", corrected: "I went yesterday", category: "tense-aspect", note: "past" },
    { original: "a apple", corrected: "an apple", category: "article" },
    { original: "an hour", corrected: "an hour", category: "article" },
  ],
  betterPhrases: [{ original: "very good", better: "excellent" }],
  newWords: [
    { word: "  Borrow ", sentence: "Can I borrow it?", meaningTr: "ödünç almak" },
    { word: "lend" },
  ],
  summary: "ok",
  ...over,
});

describe("speaking.saveReport", () => {
  it("stores the session, its errors and the new words together", async () => {
    const repo = createIndexedDbRepository(freshName());
    const startedAt = new Date(2026, 10, 17, 20, 0).toISOString();
    const result = await repo.speaking.saveReport({ scenarioId: "cafe", startedAt }, report());
    expect(result).toMatchObject({ ok: true, errorsSaved: 3, wordsAdded: 2, wordsSkipped: 0 });
    expect(result.session).toMatchObject({ scenarioId: "cafe", startedAt, rawReport: report() });

    const errors = await repo.speaking.listErrors(result.session.id);
    expect(errors).toHaveLength(3);
    expect(errors.find((e) => e.category === "tense-aspect")).toMatchObject({ original: "I go yesterday", note: "past", sessionId: result.session.id });
    expect(errors.find((e) => e.corrected === "an apple")).not.toHaveProperty("note");

    const inbox = await repo.inbox.list();
    expect(inbox.map((i) => i.word).sort()).toEqual(["Borrow", "lend"]);
    expect(inbox.every((i) => i.source.kind === "konusma")).toBe(true);
    expect(inbox.find((i) => i.word === "Borrow")).toMatchObject({ sentence: "Can I borrow it?", meaningTr: "ödünç almak" });
  });

  it("skips words that are blank, already in the inbox, already learning, or repeated in the report", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.inbox.add({ word: "borrow", source: { kind: "diger" } });
    const learning = await repo.inbox.add({ word: "walk", source: { kind: "diger" } });
    if (!learning.ok) throw new Error("add failed");
    await repo.words.triage(learning.item.id, "learning", new Date(2026, 10, 17));

    const result = await repo.speaking.saveReport(
      { scenarioId: "cafe", startedAt: new Date(2026, 10, 17).toISOString() },
      report({ newWords: [{ word: "Borrow" }, { word: "walk" }, { word: "  " }, { word: "fresh" }, { word: "FRESH" }] }),
    );
    expect(result).toMatchObject({ wordsAdded: 1, wordsSkipped: 4 });
    expect((await repo.inbox.list()).map((i) => i.word).sort()).toEqual(["borrow", "fresh"]);
  });

  it("a word the user already marked known comes back with previousStatus", async () => {
    const repo = createIndexedDbRepository(freshName());
    const known = await repo.inbox.add({ word: "borrow", source: { kind: "diger" } });
    if (!known.ok) throw new Error("add failed");
    await repo.words.triage(known.item.id, "known", new Date(2026, 10, 17));
    await repo.speaking.saveReport({ scenarioId: "cafe", startedAt: new Date(2026, 10, 17).toISOString() }, report());
    expect((await repo.inbox.list()).find((i) => i.word === "Borrow")?.previousStatus).toBe("known");
  });

  it("is all-or-nothing: a bad startedAt writes nothing", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    await repo.books.list(); // the database opens lazily; open it so the raw checks below can read it
    await expect(repo.speaking.saveReport({ scenarioId: "cafe", startedAt: "not a date" }, report())).rejects.toThrow(RangeError);
    const raw = await openDB(name);
    expect(await raw.count("speakingSessions")).toBe(0);
    expect(await raw.count("speakingErrors")).toBe(0);
    expect(await raw.count("inbox")).toBe(0);
    raw.close();
  });

  it("rolls back everything when a write fails half way", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    // A function cannot be stored in IndexedDB: the put of the error row throws AFTER the session
    // row was already written in the same transaction, so the session must disappear again.
    const broken = report({ errors: [{ original: (() => 1) as unknown as string, corrected: "x", category: "article" }] });
    await expect(repo.speaking.saveReport({ scenarioId: "cafe", startedAt: new Date(2026, 10, 17).toISOString() }, broken)).rejects.toThrow();
    const raw = await openDB(name);
    expect(await raw.count("speakingSessions")).toBe(0);
    expect(await raw.count("speakingErrors")).toBe(0);
    expect(await raw.count("inbox")).toBe(0);
    raw.close();
  });

  it("notifies subscribers once", async () => {
    const repo = createIndexedDbRepository(freshName());
    const listener = vi.fn();
    repo.subscribe(listener);
    await repo.speaking.saveReport({ scenarioId: "cafe", startedAt: new Date().toISOString() }, report());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("speaking.errorsPerCategory", () => {
  it("counts errors of sessions that started inside the range, per category", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.speaking.saveReport({ scenarioId: "a", startedAt: new Date(2026, 10, 10, 23, 30).toISOString() }, report({ newWords: [] }));
    await repo.speaking.saveReport({ scenarioId: "b", startedAt: new Date(2026, 10, 12, 8).toISOString() }, report({ newWords: [] }));
    await repo.speaking.saveReport(
      { scenarioId: "c", startedAt: new Date(2026, 10, 20, 8).toISOString() },
      report({ newWords: [], errors: [{ original: "x", corrected: "y", category: "word-order" }] }),
    );
    expect(await repo.speaking.errorsPerCategory({ from: "2026-11-11", to: "2026-11-17" })).toEqual({ "tense-aspect": 1, article: 2 });
    expect(await repo.speaking.errorsPerCategory({ from: "2026-11-10", to: "2026-11-20" })).toEqual({ "tense-aspect": 2, article: 4, "word-order": 1 });
    expect(await repo.speaking.errorsPerCategory({ from: "2026-12-01", to: "2026-12-02" })).toEqual({});
  });

  it("ignores soft-deleted sessions and errors", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    const saved = await repo.speaking.saveReport({ scenarioId: "a", startedAt: new Date(2026, 10, 12, 8).toISOString() }, report({ newWords: [] }));
    const range = { from: "2026-11-12", to: "2026-11-12" };
    const [errorRow] = await repo.speaking.listErrors(saved.session.id);
    if (!errorRow) throw new Error("no error row");
    await repo.sync.applyRemote("speakingErrors", [{ ...errorRow, updatedAt: "2099-01-01T00:00:00.000Z", deletedAt: "2099-01-01T00:00:00.000Z" }]);
    const counts = await repo.speaking.errorsPerCategory(range);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2);
    await repo.sync.applyRemote("speakingSessions", [{ ...saved.session, updatedAt: "2099-01-01T00:00:00.000Z", deletedAt: "2099-01-01T00:00:00.000Z" }]);
    expect(await repo.speaking.errorsPerCategory(range)).toEqual({});
  });
});
