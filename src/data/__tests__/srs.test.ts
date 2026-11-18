import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import type { Repository } from "../repository";
import { LEECH_THRESHOLD, recallProbability } from "../srs/scheduler";
import type { Card } from "../types";

function freshDbName(): string {
  return `eng-learn-srs-test-${crypto.randomUUID()}`;
}

/** Local date and time (month is 1-based). Tests run with TZ Europe/Istanbul (see vitest.config). */
function local(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

const NOW = local(2026, 11, 17, 10, 0);

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Capture a word and sort it as "learning" at `now`. Returns the word id. */
async function learnWord(repo: Repository, word: string, now: Date = NOW): Promise<string> {
  const added = await repo.inbox.add({ word, source: { kind: "diger" } });
  if (!added.ok) throw new Error(`add failed: ${added.reason}`);
  const result = await repo.words.triage(added.item.id, "learning", now);
  if (!result.ok) throw new Error(`triage failed: ${result.reason}`);
  return result.word.id;
}

/** The only card in a fresh queue, found through the public API. */
async function firstCard(repo: Repository, now: Date = NOW): Promise<Card> {
  const queue = await repo.cards.getReviewQueue(now);
  const first = queue.cards[0];
  if (!first) throw new Error("queue is empty");
  return first.card;
}

/**
 * Give Good answers (each one when the card is due) until the card is in the Review state.
 * Returns the time of the next review, so the caller can continue from there.
 */
async function reachReview(
  repo: Repository,
  cardId: string,
  start: Date,
): Promise<{ card: Card; when: Date }> {
  let when = start;
  for (let i = 0; i < 10; i += 1) {
    const step = await repo.cards.reviewCard(cardId, "good", when);
    if (!step.ok) throw new Error("review failed");
    // Next answer happens when the card is due (plus a minute, so it is surely due).
    when = minutesAfter(new Date(step.card.dueAt), 1);
    if (step.card.state === 2) return { card: step.card, when };
  }
  throw new Error("card never reached the Review state");
}

describe("database upgrade", () => {
  it("keeps books, inbox and words when a version 1 database is upgraded to the latest version", async () => {
    const name = freshDbName();

    // Build a version 1 database by hand, exactly as the Faz 1 code created it.
    const v1 = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore("books", { keyPath: "id" });
        const inbox = database.createObjectStore("inbox", { keyPath: "id" });
        inbox.createIndex("by-normalized", "normalized", { unique: true });
        inbox.createIndex("by-createdAt", "createdAt");
        const words = database.createObjectStore("words", { keyPath: "id" });
        words.createIndex("by-normalized", "normalized", { unique: true });
        words.createIndex("by-status", "status");
        const activity = database.createObjectStore("activity", { keyPath: "id" });
        activity.createIndex("by-startedAt", "startedAt");
        database.createObjectStore("settings");
      },
    });
    const book = { id: "b1", title: "My Book", shortName: "MB", unit: 2, page: 9 };
    const inboxItem = {
      id: "i1",
      word: "Anchor",
      normalized: "anchor",
      source: { kind: "diger" },
      createdAt: "2026-11-01T08:00:00.000Z",
    };
    const word = {
      id: "w1",
      lemma: "harbor",
      normalized: "harbor",
      status: "known",
      source: { kind: "diger" },
      createdAt: "2026-11-01T08:00:00.000Z",
      updatedAt: "2026-11-01T08:00:00.000Z",
    };
    await v1.put("books", book);
    await v1.put("inbox", inboxItem);
    await v1.put("words", word);
    v1.close();

    const repo = createIndexedDbRepository(name);
    // v4 gave the old book an updatedAt; everything else is unchanged.
    expect(await repo.books.list()).toEqual([{ ...book, updatedAt: expect.any(String) }]);
    expect((await repo.inbox.list()).map((i) => i.word)).toEqual(["Anchor"]);
    expect((await repo.words.listByStatus("known")).map((w) => w.lemma)).toEqual(["harbor"]);
    // The new stores exist and work.
    expect((await repo.cards.getReviewQueue(NOW)).dueTotal).toBe(0);

    const raw = await openDB(name);
    expect(raw.version).toBe(4);
    expect([...raw.objectStoreNames].sort()).toEqual(
      [
        "activity", "books", "cards", "inbox", "reviewLogs", "settings", "words",
        "videos", "speakingSessions", "speakingErrors",
      ].sort(),
    );
    raw.close();
  });
});

describe("triage: learn", () => {
  it("creates the word and its card together, and removes the inbox item", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    const wordId = await learnWord(repo, "anchor");

    expect((await repo.words.listByStatus("learning")).map((w) => w.id)).toEqual([wordId]);
    expect(await repo.inbox.list()).toEqual([]);

    const raw = await openDB(name);
    const cards = await raw.getAll("cards");
    raw.close();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      wordId,
      state: 0,
      lapses: 0,
      leech: false,
      createdAt: NOW.toISOString(),
      dueAt: NOW.toISOString(),
    });
  });

  it("creates no card for known or ignored words", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    for (const [word, status] of [["a1", "known"], ["b1", "ignored"]] as const) {
      const added = await repo.inbox.add({ word, source: { kind: "diger" } });
      if (!added.ok) throw new Error("add failed");
      await repo.words.triage(added.item.id, status, NOW);
    }
    const raw = await openDB(name);
    expect(await raw.count("cards")).toBe(0);
    raw.close();
  });

  it("allows 10 new cards per local day, refuses the 11th without changes, allows more the next day", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    for (let i = 0; i < 10; i += 1) await learnWord(repo, `word${i}`);

    const eleventh = await repo.inbox.add({ word: "word10", source: { kind: "diger" } });
    if (!eleventh.ok) throw new Error("add failed");
    expect(await repo.words.triage(eleventh.item.id, "learning", NOW)).toEqual({
      ok: false,
      reason: "new-card-limit",
    });
    // Nothing changed: the item is still in the inbox and no word was created.
    expect((await repo.inbox.list()).map((i) => i.word)).toEqual(["word10"]);
    expect(await repo.words.listByStatus("learning")).toHaveLength(10);

    // Known words do not use up the limit, only cards do.
    expect((await repo.words.triage(eleventh.item.id, "known", NOW)).ok).toBe(true);

    // 23:59 on the same local day still counts as the same day ...
    const late = await repo.inbox.add({ word: "late", source: { kind: "diger" } });
    if (!late.ok) throw new Error("add failed");
    expect(await repo.words.triage(late.item.id, "learning", local(2026, 11, 17, 23, 59))).toEqual({
      ok: false,
      reason: "new-card-limit",
    });
    // ... and just after local midnight it is a new day.
    const next = await repo.words.triage(late.item.id, "learning", local(2026, 11, 18, 0, 1));
    expect(next.ok).toBe(true);

    const queue = await repo.cards.getReviewQueue(local(2026, 11, 18, 0, 2));
    expect(queue.newToday).toBe(1);
    expect(queue.newLimit).toBe(10);
  });

  it("respects a changed newCardLimit setting", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await repo.settings.update({ newCardLimit: 1 });
    await learnWord(repo, "one");
    const two = await repo.inbox.add({ word: "two", source: { kind: "diger" } });
    if (!two.ok) throw new Error("add failed");
    expect(await repo.words.triage(two.item.id, "learning", NOW)).toEqual({
      ok: false,
      reason: "new-card-limit",
    });
  });
});

describe("re-capture", () => {
  it("allows a known word again with previousStatus, and triage updates the same Word", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    const first = await repo.inbox.add({ word: "light", source: { kind: "diger" } });
    if (!first.ok) throw new Error("add failed");
    const known = await repo.words.triage(first.item.id, "known", NOW);
    if (!known.ok) throw new Error("triage failed");

    const again = await repo.inbox.add({
      word: " Light",
      sentence: "The light was bright.",
      source: { kind: "video", label: "Ted" },
    });
    if (!again.ok) throw new Error(`re-capture refused: ${again.reason}`);
    expect(again.item.previousStatus).toBe("known");
    expect((await repo.inbox.list())[0]?.previousStatus).toBe("known");

    const later = minutesAfter(NOW, 30);
    const learned = await repo.words.triage(again.item.id, "learning", later);
    if (!learned.ok) throw new Error("triage failed");

    expect(learned.word.id).toBe(known.word.id);
    expect(learned.word).toMatchObject({
      status: "learning",
      sentence: "The light was bright.",
      source: { kind: "video", label: "Ted" },
      createdAt: known.word.createdAt,
      updatedAt: later.toISOString(),
    });
    expect(await repo.words.listByStatus("known")).toEqual([]);
    expect(await repo.words.listByStatus("learning")).toHaveLength(1);

    const raw = await openDB(name);
    expect(await raw.count("words")).toBe(1);
    expect(await raw.count("cards")).toBe(1);
    raw.close();
  });

  it("allows an ignored word again, and triage back to ignored creates no card", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    const first = await repo.inbox.add({ word: "moon", source: { kind: "diger" } });
    if (!first.ok) throw new Error("add failed");
    await repo.words.triage(first.item.id, "ignored", NOW);

    const again = await repo.inbox.add({ word: "moon", source: { kind: "konusma" } });
    if (!again.ok) throw new Error("re-capture refused");
    expect(again.item.previousStatus).toBe("ignored");
    expect((await repo.words.triage(again.item.id, "known", NOW)).ok).toBe(true);

    const raw = await openDB(name);
    expect(await raw.count("cards")).toBe(0);
    expect(await raw.count("words")).toBe(1);
    raw.close();
  });

  it("refuses a word that is already being learned", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "anchor");
    expect(await repo.inbox.add({ word: "Anchor", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "already-learning",
    });
  });

  it("keeps rejecting a second inbox item for the same re-captured word", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    const first = await repo.inbox.add({ word: "light", source: { kind: "diger" } });
    if (!first.ok) throw new Error("add failed");
    await repo.words.triage(first.item.id, "known", NOW);
    await repo.inbox.add({ word: "light", source: { kind: "diger" } });
    expect(await repo.inbox.add({ word: "LIGHT", source: { kind: "diger" } })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("review queue", () => {
  it("sorts by recall probability (lowest first), not by due date", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    const stableId = await learnWord(repo, "stable");
    const fragileId = await learnWord(repo, "fragile");
    await learnWord(repo, "fresh");

    // Hand-made memory states, written straight into the store:
    // - stable: strong memory, reviewed 20 days ago, due 5 days ago (the EARLIER due date)
    // - fragile: weak memory, reviewed 10 days ago, due 1 day ago (the LATER due date)
    // - fresh: never reviewed (probability 0), must come first
    const queueNow = local(2026, 12, 1, 10, 0);
    const raw = await openDB(name);
    const index = raw.transaction("cards").store.index("by-wordId");
    const stable = await index.get(stableId);
    const fragile = await index.get(fragileId);
    if (!stable || !fragile) throw new Error("cards missing");
    await raw.put("cards", {
      ...stable,
      state: 2,
      scheduleStatus: "review",
      stability: 200,
      stabilityFast: 200,
      difficulty: 5,
      lastReviewAt: daysAfter(queueNow, -20).toISOString(),
      dueAt: daysAfter(queueNow, -5).toISOString(),
      reps: 4,
    });
    await raw.put("cards", {
      ...fragile,
      state: 2,
      scheduleStatus: "review",
      stability: 2,
      stabilityFast: 2,
      difficulty: 8,
      lastReviewAt: daysAfter(queueNow, -10).toISOString(),
      dueAt: daysAfter(queueNow, -1).toISOString(),
      reps: 4,
    });
    raw.close();

    const queue = await repo.cards.getReviewQueue(queueNow);
    expect(queue.cards.map((entry) => entry.word.lemma)).toEqual(["fresh", "fragile", "stable"]);
    expect(queue.dueTotal).toBe(3);

    const probabilities = await Promise.all(queue.cards.map((e) => recallProbability(e.card, queueNow)));
    expect(probabilities[0]).toBe(0);
    expect(probabilities[1]).toBeLessThan(probabilities[2] ?? 0);
  });

  it("only lists cards that are due", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "anchor");
    const card = await firstCard(repo);
    await repo.cards.reviewCard(card.id, "good", NOW);

    // A Good answer pushes the due date days ahead, so right after it nothing is due.
    const queue = await repo.cards.getReviewQueue(minutesAfter(NOW, 1));
    expect(queue.cards).toEqual([]);
    expect(queue.dueTotal).toBe(0);
  });

  it("cuts the list to fit maxMinutes and reports the estimate", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    for (let i = 0; i < 5; i += 1) await learnWord(repo, `word${i}`);

    const queue = await repo.cards.getReviewQueue(NOW, { maxMinutes: 1, secondsPerCard: 20 });
    expect(queue.cards).toHaveLength(3);
    expect(queue.dueTotal).toBe(5);
    expect(queue.estimatedMinutes).toBe(1);

    const defaults = await repo.cards.getReviewQueue(NOW);
    expect(defaults.cards).toHaveLength(5);
    expect(defaults.estimatedMinutes).toBeCloseTo((5 * 20) / 60);
    expect(defaults.newToday).toBe(5);
  });
});

describe("reviewCard", () => {
  it("Good moves the due date forward and writes a log with the previous card", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    await learnWord(repo, "anchor");
    const before = await firstCard(repo);

    const result = await repo.cards.reviewCard(before.id, "good", NOW);
    if (!result.ok) throw new Error("review failed");
    expect(new Date(result.card.dueAt).getTime()).toBeGreaterThan(daysAfter(NOW, 1).getTime());
    expect(result.card.reps).toBe(1);
    expect(result.card.lapses).toBe(0);
    expect(result.card.lastReviewAt).toBe(NOW.toISOString());
    expect(result.log).toMatchObject({
      cardId: before.id,
      grade: "good",
      reviewedAt: NOW.toISOString(),
      previousCard: before,
    });
    expect(result.log.revlog.rating).toBe(3);

    const raw = await openDB(name);
    expect(await raw.count("reviewLogs")).toBe(1);
    raw.close();
  });

  it("Again keeps the card short (minutes) and does not count a lapse on a new card", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "anchor");
    const before = await firstCard(repo);

    const result = await repo.cards.reviewCard(before.id, "again", NOW);
    if (!result.ok) throw new Error("review failed");
    const waitMinutes = (new Date(result.card.dueAt).getTime() - NOW.getTime()) / 60_000;
    expect(waitMinutes).toBeGreaterThan(0);
    expect(waitMinutes).toBeLessThan(60);
    expect(result.card.lapses).toBe(0);
  });

  it("counts a lapse for Again on a card in the Review state", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "anchor");
    const card = await firstCard(repo);
    const good = await repo.cards.reviewCard(card.id, "good", NOW);
    if (!good.ok) throw new Error("review failed");
    // The lapse rule only applies from the Review state (2), so make sure we are there.
    expect(good.card.state).toBe(2);

    const again = await repo.cards.reviewCard(card.id, "again", daysAfter(NOW, 5));
    if (!again.ok) throw new Error("review failed");
    expect(again.card.lapses).toBe(1);
    expect(again.card.leech).toBe(false);
    expect(again.card.scheduledDays).toBeLessThan(1);
  });

  it("does not count Again during learning or relearning steps", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "anchor");
    const card = await firstCard(repo);

    // Four Agains in a row on a card that never reached Review: all are step failures.
    let when = NOW;
    for (let i = 0; i < 4; i += 1) {
      const step = await repo.cards.reviewCard(card.id, "again", when);
      if (!step.ok) throw new Error("review failed");
      expect(step.card.state).not.toBe(2);
      expect(step.card.lapses).toBe(0);
      when = minutesAfter(when, 15);
    }

    // Reach Review, forget once (lapse 1, now Relearning), then fail the relearning step twice.
    const reached = await reachReview(repo, card.id, when);
    when = reached.when;
    const lapse = await repo.cards.reviewCard(card.id, "again", when);
    if (!lapse.ok) throw new Error("review failed");
    expect(lapse.card.state).toBe(3);
    expect(lapse.card.lapses).toBe(1);
    when = minutesAfter(when, 15);
    for (let i = 0; i < 2; i += 1) {
      const retry = await repo.cards.reviewCard(card.id, "again", when);
      if (!retry.ok) throw new Error("review failed");
      expect(retry.card.state).toBe(3);
      expect(retry.card.lapses).toBe(1);
      when = minutesAfter(when, 15);
    }
  });

  it("flags a leech at 5 lapses and lists it", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "stubborn");
    const card = await firstCard(repo);
    expect(LEECH_THRESHOLD).toBe(5);

    // Each lapse needs a trip back to Review: Good until Review, then one Again.
    let when = NOW;
    let current = card;
    for (let lapse = 1; lapse <= 5; lapse += 1) {
      const reached = await reachReview(repo, card.id, when);
      when = reached.when;
      const step = await repo.cards.reviewCard(card.id, "again", when);
      if (!step.ok) throw new Error("review failed");
      current = step.card;
      when = minutesAfter(when, 15);
      expect(current.lapses).toBe(lapse);
      expect(current.leech).toBe(lapse === 5);
      if (lapse === 4) expect(await repo.cards.listLeeches()).toEqual([]);
    }

    const leeches = await repo.cards.listLeeches();
    expect(leeches.map((l) => l.word.lemma)).toEqual(["stubborn"]);
  });

  it("returns not-found for an unknown card", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    expect(await repo.cards.reviewCard("nope", "good", NOW)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("undoLastReview", () => {
  it("restores the previous card and deletes the last log", async () => {
    const name = freshDbName();
    const repo = createIndexedDbRepository(name);
    await learnWord(repo, "anchor");
    const before = await firstCard(repo);
    await repo.cards.reviewCard(before.id, "good", NOW);

    const undone = await repo.cards.undoLastReview();
    // Same memory state as before the review; only updatedAt is newer (so sync sees the undo).
    const restored = { ...before, updatedAt: expect.any(String) };
    expect(undone).toEqual({ ok: true, card: restored });
    expect(undone.ok && undone.card.updatedAt > before.updatedAt).toBe(true);

    expect(await firstCard(repo)).toEqual(restored);
    // The log is soft deleted: its row stays (marked) so a later sync can push the deletion.
    const raw = await openDB(name);
    const logs = await raw.getAll("reviewLogs");
    expect(logs).toHaveLength(1);
    expect(logs[0].deletedAt).toEqual(expect.any(String));
    raw.close();
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
  });

  it("undoes only the newest review and also takes back a leech flag", async () => {
    const repo = createIndexedDbRepository(freshDbName());
    await learnWord(repo, "stubborn");
    const card = await firstCard(repo);
    let when = NOW;
    // Four lapses (each: back to Review, then Again), then the fifth lapse sets the leech flag.
    for (let lapse = 1; lapse <= 4; lapse += 1) {
      when = (await reachReview(repo, card.id, when)).when;
      const step = await repo.cards.reviewCard(card.id, "again", when);
      if (!step.ok) throw new Error("review failed");
      when = minutesAfter(when, 15);
    }
    const reached = await reachReview(repo, card.id, when);
    const beforeLast = reached.card;
    expect(beforeLast.leech).toBe(false);
    const last = await repo.cards.reviewCard(card.id, "again", reached.when);
    if (!last.ok) throw new Error("review failed");
    expect(last.card.leech).toBe(true);
    expect((await repo.cards.listLeeches()).length).toBe(1);

    const undone = await repo.cards.undoLastReview();
    expect(undone).toEqual({ ok: true, card: { ...beforeLast, updatedAt: expect.any(String) } });
    expect(await repo.cards.listLeeches()).toEqual([]);
  });
});

describe("database upgrade to version 3 (normalized keys)", () => {
  async function makeV2(name: string) {
    const db = await openDB(name, 2, {
      upgrade(database) {
        database.createObjectStore("books", { keyPath: "id" });
        const inbox = database.createObjectStore("inbox", { keyPath: "id" });
        inbox.createIndex("by-normalized", "normalized", { unique: true });
        inbox.createIndex("by-createdAt", "createdAt");
        const words = database.createObjectStore("words", { keyPath: "id" });
        words.createIndex("by-normalized", "normalized", { unique: true });
        words.createIndex("by-status", "status");
        const activity = database.createObjectStore("activity", { keyPath: "id" });
        activity.createIndex("by-startedAt", "startedAt");
        database.createObjectStore("settings");
        const cards = database.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("by-wordId", "wordId", { unique: true });
        cards.createIndex("by-due", "dueAt");
        const logs = database.createObjectStore("reviewLogs", { keyPath: "id" });
        logs.createIndex("by-reviewedAt", "reviewedAt");
        logs.createIndex("by-cardId", "cardId");
      },
    });
    return db;
  }
  const base = { status: "known", source: { kind: "diger" }, updatedAt: "2026-11-01T08:00:00.000Z" };

  it("recomputes keys, and keeps the older record's key on a collision", async () => {
    const name = freshDbName();
    const db = await makeV2(name);
    await db.put("words", { ...base, id: "w1", lemma: "Don\u2019t", normalized: "don\u2019t", createdAt: "2026-11-01T08:00:00.000Z" });
    await db.put("words", { ...base, id: "w2", lemma: "don't", normalized: "don't", createdAt: "2026-11-02T08:00:00.000Z" });
    await db.put("words", { ...base, id: "w3", lemma: "grab  a coffee", normalized: "grab  a coffee", createdAt: "2026-11-03T08:00:00.000Z" });
    await db.put("words", { ...base, id: "w4", lemma: "Do\u2019nt", normalized: "do\u2019nt", createdAt: "2026-11-04T08:00:00.000Z" });
    await db.put("words", { ...base, id: "w5", lemma: "do'nt", normalized: "do'nt", createdAt: "2026-11-05T08:00:00.000Z" });
    await db.put("inbox", { id: "i1", word: "it\u2019s", normalized: "it\u2019s", source: { kind: "diger" }, createdAt: "2026-11-01T08:00:00.000Z" });
    db.close();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = createIndexedDbRepository(name);
    await repo.books.list();
    const raw = await openDB(name);
    expect(raw.version).toBe(4);
    const keys = Object.fromEntries((await raw.getAll("words")).map((w) => [w.id, w.normalized]));
    // w2 already held the canonical key, so it keeps it; w1 (older) cannot take it and keeps its old key.
    expect(keys.w2).toBe("don't");
    expect(keys.w1).toBe("don\u2019t");
    expect(keys.w3).toBe("grab a coffee");
    // w4 is older than w5 but w5 already holds the canonical key.
    expect(keys.w5).toBe("do'nt");
    expect(keys.w4).toBe("do\u2019nt");
    expect((await raw.getAll("inbox"))[0].normalized).toBe("it's");
    expect((await raw.getAll("words")).length).toBe(5);
    expect(warn).toHaveBeenCalledTimes(2);
    raw.close();
    warn.mockRestore();

    // The new key is what duplicate detection sees now.
    const dup = await repo.inbox.add({ word: "IT'S", source: { kind: "diger" } });
    expect(dup.ok).toBe(false);
  });

  it("gives the older record the canonical key when neither holds it yet", async () => {
    const name = freshDbName();
    const db = await makeV2(name);
    await db.put("words", { ...base, id: "a", lemma: "x\u2019y", normalized: "x\u2019y", createdAt: "2026-11-01T08:00:00.000Z" });
    await db.put("words", { ...base, id: "b", lemma: "x\u2018y", normalized: "x\u2018y", createdAt: "2026-11-02T08:00:00.000Z" });
    db.close();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = createIndexedDbRepository(name);
    await repo.books.list();
    const raw = await openDB(name);
    const keys = Object.fromEntries((await raw.getAll("words")).map((w) => [w.id, w.normalized]));
    expect(keys).toEqual({ a: "x'y", b: "x\u2018y" });
    raw.close();
    vi.restoreAllMocks();
  });
});
