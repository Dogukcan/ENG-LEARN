// Tests for the v4 sync layer: the v3 -> v4 upgrade, soft deletes, listChangedSince, applyRemote.
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import type { Repository } from "../repository";

const freshName = () => `eng-learn-sync-test-${crypto.randomUUID()}`;
const NOW = new Date(2026, 10, 17, 10, 0);
const EPOCH = "1970-01-01T00:00:00.000Z";

async function learn(repo: Repository, word: string) {
  const added = await repo.inbox.add({ word, source: { kind: "diger" } });
  if (!added.ok) throw new Error("add failed");
  const triaged = await repo.words.triage(added.item.id, "learning", NOW);
  if (!triaged.ok) throw new Error("triage failed");
  return triaged.word;
}

describe("upgrade v3 -> v4", () => {
  it("keeps every v3 record and backfills updatedAt", async () => {
    const name = freshName();
    const v3 = await openDB(name, 3, {
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
    const created = "2026-11-01T08:00:00.000Z";
    const card = {
      id: "c1", wordId: "w1", stability: 1, stabilityFast: 1, difficulty: 5, state: 2,
      scheduleStatus: "review", dueAt: created, lastReviewAt: null, reps: 1, scheduledDays: 1,
      learningStep: 0, lapses: 0, leech: false, createdAt: created,
    };
    await v3.put("books", { id: "b1", title: "Book", shortName: "B", unit: 2, page: 9 });
    await v3.put("inbox", { id: "i1", word: "Anchor", normalized: "anchor", source: { kind: "diger" }, createdAt: created });
    await v3.put("words", { id: "w1", lemma: "harbor", normalized: "harbor", status: "learning", source: { kind: "diger" }, createdAt: created, updatedAt: "2026-11-02T08:00:00.000Z" });
    await v3.put("cards", card);
    await v3.put("reviewLogs", { id: "r1", cardId: "c1", grade: "good", reviewedAt: "2026-11-03T08:00:00.000Z", revlog: {}, previousCard: card });
    await v3.put("activity", { id: "a1", block: "okuma", startedAt: "2026-11-04T08:00:00.000Z", seconds: 600, source: "timer" });
    await v3.put("settings", { newCardLimit: 7 }, "app");
    v3.close();

    const repo = createIndexedDbRepository(name);
    expect((await repo.books.list()).map((b) => [b.id, b.title, b.unit, b.page])).toEqual([["b1", "Book", 2, 9]]);
    expect((await repo.inbox.list()).map((i) => i.word)).toEqual(["Anchor"]);
    expect((await repo.words.listByStatus("learning")).map((w) => w.lemma)).toEqual(["harbor"]);
    expect((await repo.settings.get()).newCardLimit).toBe(7);
    expect((await repo.activity.listForDay("2026-11-04"))[0]?.seconds).toBe(600);

    const raw = await openDB(name);
    expect(raw.version).toBe(6);
    const inbox = await raw.get("inbox", "i1");
    expect(inbox?.updatedAt).toBe(created); // guessed from createdAt
    expect((await raw.get("words", "w1"))?.updatedAt).toBe("2026-11-02T08:00:00.000Z"); // kept
    expect((await raw.get("cards", "c1"))?.updatedAt).toBe(created);
    const log = await raw.get("reviewLogs", "r1");
    expect(log?.updatedAt).toBe("2026-11-03T08:00:00.000Z");
    expect(log?.previousCard.updatedAt).toBe(created);
    expect((await raw.get("activity", "a1"))?.updatedAt).toBe("2026-11-04T08:00:00.000Z");
    expect(typeof (await raw.get("books", "b1"))?.updatedAt).toBe("string"); // no createdAt: now
    expect((await raw.get("settings", "app"))?.id).toBe("app");
    for (const store of ["books", "inbox", "words", "cards", "reviewLogs", "activity", "settings", "videos", "speakingSessions", "speakingErrors"] as const) {
      expect(raw.transaction(store).store.indexNames.contains("by-updatedAt")).toBe(true);
    }
    raw.close();

    // The backfilled records are visible to sync.
    const rows = await repo.sync.listChangedSince("inbox", EPOCH);
    expect(rows.map((r) => r.id)).toEqual(["i1"]);
    expect(rows[0]).not.toHaveProperty("normalized");
  });
});

describe("soft deletes", () => {
  it("inbox remove keeps a marked row, frees the word and restore brings it back", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    const added = await repo.inbox.add({ word: "borrow", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");
    await repo.inbox.remove(added.item.id);
    expect(await repo.inbox.list()).toEqual([]);
    expect(await repo.inbox.remove(added.item.id)).toBeUndefined(); // already gone

    const raw = await openDB(name);
    const row = await raw.get("inbox", added.item.id);
    raw.close();
    expect(row?.deletedAt).toEqual(expect.any(String));
    expect(row?.updatedAt >= added.item.updatedAt).toBe(true);

    // The same word can be captured again (the unique key was freed) ...
    const again = await repo.inbox.add({ word: "borrow", source: { kind: "diger" } });
    expect(again.ok).toBe(true);
    // ... and restoring the old item is then a duplicate.
    expect(await repo.inbox.restore(added.item)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("triage soft deletes the inbox item and the change is listed for sync", async () => {
    const repo = createIndexedDbRepository(freshName());
    await learn(repo, "walk");
    expect(await repo.inbox.list()).toEqual([]);
    const rows = await repo.sync.listChangedSince("inbox", EPOCH);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toEqual(expect.any(String));
  });

  it("undoing a review soft deletes the log and the undo itself is newer than the review", async () => {
    const repo = createIndexedDbRepository(freshName());
    const word = await learn(repo, "walk");
    const queue = await repo.cards.getReviewQueue(NOW);
    const card = queue.cards[0]?.card;
    if (!card) throw new Error("no card");
    const reviewed = await repo.cards.reviewCard(card.id, "good", NOW);
    if (!reviewed.ok) throw new Error("review failed");
    const undone = await repo.cards.undoLastReview();
    if (!undone.ok) throw new Error("undo failed");
    expect(undone.card.updatedAt > reviewed.card.updatedAt).toBe(true);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.deletedAt).toEqual(expect.any(String));
    // A second undo finds no live log.
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(word.lemma).toBe("walk");
  });
});

describe("listChangedSince", () => {
  it("returns rows strictly after the time, oldest first, including deleted rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      const repo = createIndexedDbRepository(freshName());
      const a = await repo.inbox.add({ word: "alpha", source: { kind: "diger" } });
      vi.setSystemTime(NOW.getTime() + 1);
      const b = await repo.inbox.add({ word: "beta", source: { kind: "diger" } });
      if (!a.ok || !b.ok) throw new Error("add failed");
      const all = await repo.sync.listChangedSince("inbox", EPOCH);
      expect(all.map((r) => r.id).sort()).toEqual([a.item.id, b.item.id].sort());
      // Oldest first: the updatedAt values never go down.
      expect(all.map((r) => r.updatedAt)).toEqual([...all.map((r) => r.updatedAt)].sort());
      const latest = all[all.length - 1]?.updatedAt ?? "";
      expect(await repo.sync.listChangedSince("inbox", latest)).toEqual([]);
      vi.setSystemTime(NOW.getTime() + 2);
      await repo.inbox.remove(a.item.id);
      const changed = await repo.sync.listChangedSince("inbox", latest);
      expect(changed.map((r) => r.id)).toEqual([a.item.id]);
      expect(changed[0]?.deletedAt).toEqual(expect.any(String));
    } finally {
      vi.useRealTimers();
    }
  });

  it("settings appear as one complete row with id app, only after the first update", async () => {
    const repo = createIndexedDbRepository(freshName());
    expect(await repo.sync.listChangedSince("settings", EPOCH)).toEqual([]);
    await repo.settings.update({ newCardLimit: 5 });
    const rows = await repo.sync.listChangedSince("settings", EPOCH);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "app", newCardLimit: 5, dailyMinimumMinutes: 20 });
  });

  it("works for the other stores too", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.activity.add({ block: "okuma", startedAt: NOW.toISOString(), seconds: 60, source: "timer" });
    await repo.videos.add({ youtubeId: "abcdefghijk", title: "T", channel: "C", level: "kolay", durationMinutes: 5 });
    expect(await repo.sync.listChangedSince("activity", EPOCH)).toHaveLength(1);
    const videos = await repo.sync.listChangedSince("videos", EPOCH);
    expect(videos).toHaveLength(1);
    expect(videos[0]).not.toHaveProperty("youtubeKey");
    // Seed books sit at the epoch on purpose: they are not a real edit and are never pushed.
    expect((await repo.sync.listChangedSince("books", EPOCH)).length).toBe(0);
  });
});

describe("applyRemote", () => {
  const inboxRow = (over: Record<string, unknown> = {}) => ({
    id: "i-remote",
    word: "Remote",
    source: { kind: "diger" },
    createdAt: "2026-11-10T08:00:00.000Z",
    updatedAt: "2026-11-10T08:00:00.000Z",
    sentence: null, // Postgres NULL must become "missing"
    ...over,
  });

  it("inserts a new row and does not push it back (updatedAt is kept)", async () => {
    const repo = createIndexedDbRepository(freshName());
    const result = await repo.sync.applyRemote("inbox", [inboxRow()]);
    expect(result).toEqual({ applied: 1, skipped: 0, conflicts: 0, invalid: 0 });
    const list = await repo.inbox.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.updatedAt).toBe("2026-11-10T08:00:00.000Z");
    expect(list[0]).not.toHaveProperty("sentence");
    // The duplicate rule uses the remote word too.
    expect(await repo.inbox.add({ word: "remote", source: { kind: "diger" } })).toEqual({ ok: false, reason: "duplicate" });
  });

  it("converts Postgres timestamps to the app's ISO form", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.sync.applyRemote("inbox", [inboxRow({ updatedAt: "2026-11-10T11:00:00.123456+03:00" })]);
    expect((await repo.inbox.list())[0]?.updatedAt).toBe("2026-11-10T08:00:00.123Z");
  });

  it("last write wins: older and equal remote rows are skipped, newer ones replace", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.sync.applyRemote("inbox", [inboxRow()]);
    const older = await repo.sync.applyRemote("inbox", [inboxRow({ sentence: "old", updatedAt: "2026-11-09T08:00:00.000Z" })]);
    const equal = await repo.sync.applyRemote("inbox", [inboxRow({ sentence: "equal" })]);
    expect(older.skipped + equal.skipped).toBe(2);
    expect((await repo.inbox.list())[0]?.sentence).toBeUndefined();
    const newer = await repo.sync.applyRemote("inbox", [inboxRow({ sentence: "new", updatedAt: "2026-11-11T08:00:00.000Z" })]);
    expect(newer.applied).toBe(1);
    expect((await repo.inbox.list())[0]?.sentence).toBe("new");
  });

  it("a newer remote tombstone hides the item and frees the word", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.sync.applyRemote("inbox", [inboxRow()]);
    await repo.sync.applyRemote("inbox", [inboxRow({ updatedAt: "2026-11-12T08:00:00.000Z", deletedAt: "2026-11-12T08:00:00.000Z" })]);
    expect(await repo.inbox.list()).toEqual([]);
    expect((await repo.inbox.add({ word: "remote", source: { kind: "diger" } })).ok).toBe(true);
  });

  it("a local edit that is newer than the remote row survives", async () => {
    const repo = createIndexedDbRepository(freshName());
    const [book] = await repo.books.list();
    if (!book) throw new Error("seed missing");
    const moved = await repo.books.setPosition(book.id, { unit: 4, page: 40 });
    const result = await repo.sync.applyRemote("books", [
      { id: book.id, title: book.title, shortName: book.shortName, unit: 1, page: 1, updatedAt: "2020-01-01T00:00:00.000Z" },
    ]);
    expect(result.skipped).toBe(1);
    expect((await repo.books.get(book.id))?.page).toBe(40);
    expect(moved?.page).toBe(40);
  });

  it("two different ids for the same word: the newer one wins, the loser is soft deleted", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.sync.applyRemote("words", [
      { id: "w-old", lemma: "Walk", status: "known", source: { kind: "diger" }, createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z" },
    ]);
    const newer = await repo.sync.applyRemote("words", [
      { id: "w-new", lemma: "walk", status: "learning", source: { kind: "diger" }, createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z" },
    ]);
    expect(newer).toMatchObject({ applied: 1, conflicts: 1 });
    expect((await repo.words.listByStatus("learning")).map((w) => w.id)).toEqual(["w-new"]);
    expect(await repo.words.listByStatus("known")).toEqual([]);
    // The older twin is still there as a tombstone and is queued for the next push.
    const changed = await repo.sync.listChangedSince("words", "2026-11-02T08:00:00.000Z");
    expect(changed.map((r) => [r.id, typeof r.deletedAt])).toEqual([["w-old", "string"]]);

    // The other direction: an OLDER remote word loses against the live local one.
    const older = await repo.sync.applyRemote("words", [
      { id: "w-older", lemma: "WALK", status: "ignored", source: { kind: "diger" }, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
    ]);
    expect(older).toMatchObject({ applied: 0, skipped: 1, conflicts: 1 });
  });

  it("applies cards with the one-card-per-word rule", async () => {
    const repo = createIndexedDbRepository(freshName());
    const word = await learn(repo, "walk");
    const [localCard] = await repo.sync.listChangedSince("cards", EPOCH);
    if (!localCard) throw new Error("no card");
    const remoteCard = { ...localCard, id: "c-remote", updatedAt: "2099-01-01T00:00:00.000Z" };
    const result = await repo.sync.applyRemote("cards", [remoteCard]);
    expect(result).toMatchObject({ applied: 0, skipped: 1, conflicts: 1 });
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    expect(cards.map((c) => c.id)).toEqual([localCard.id]);
    expect(cards[0]!.updatedAt > remoteCard.updatedAt).toBe(true);
    expect(cards[0]?.wordId).toBe(word.id);
    // A remote tombstone for the same word under another id does not replace a live card.
    const tomb = await repo.sync.applyRemote("cards", [
      { ...remoteCard, id: "c-tomb", updatedAt: "2099-02-01T00:00:00.000Z", deletedAt: "2099-02-01T00:00:00.000Z" },
    ]);
    expect(tomb).toMatchObject({ applied: 0, skipped: 1 });
  });

  it("revives a card that another device deleted when the word is sorted as learning again", async () => {
    const repo = createIndexedDbRepository(freshName());
    const word = await learn(repo, "walk");
    const [card] = await repo.sync.listChangedSince("cards", EPOCH);
    const [wordRow] = await repo.sync.listChangedSince("words", EPOCH);
    if (!card || !wordRow) throw new Error("rows missing");
    // The other device deleted the card and set the word to "known".
    await repo.sync.applyRemote("cards", [{ ...card, updatedAt: "2099-01-01T00:00:00.000Z", deletedAt: "2099-01-01T00:00:00.000Z" }]);
    await repo.sync.applyRemote("words", [{ ...wordRow, status: "known", updatedAt: "2099-01-01T00:00:00.000Z" }]);
    const later = new Date(2100, 0, 1);
    expect((await repo.cards.getReviewQueue(later)).cards).toEqual([]);

    // The word is captured again and sorted as learning: the word keeps its single card, live again.
    const again = await repo.inbox.add({ word: "walk", source: { kind: "diger" } });
    if (!again.ok) throw new Error("add failed");
    expect(await repo.words.triage(again.item.id, "learning", later)).toMatchObject({ ok: true });
    const queue = await repo.cards.getReviewQueue(later);
    expect(queue.cards.map((entry) => entry.word.id)).toEqual([word.id]);
  });

  it("ignores rows that do not fit the store", async () => {
    const repo = createIndexedDbRepository(freshName());
    const result = await repo.sync.applyRemote("inbox", [
      { id: "x" },
      "not an object",
      inboxRow({ source: { kind: "unknown" } }),
      inboxRow({ updatedAt: "not a date" }),
      inboxRow({ id: "good" }),
    ]);
    expect(result).toEqual({ applied: 1, skipped: 0, conflicts: 0, invalid: 4 });
    expect(await repo.inbox.list()).toHaveLength(1);
  });

  it("applies remote settings and notifies subscribers only when something was written", async () => {
    const repo = createIndexedDbRepository(freshName());
    let calls = 0;
    repo.subscribe(() => (calls += 1));
    const row = { id: "app", updatedAt: "2026-11-10T08:00:00.000Z", newCardLimit: 3, activeBookId: null };
    expect((await repo.sync.applyRemote("settings", [row])).applied).toBe(1);
    expect(calls).toBe(1);
    expect((await repo.settings.get()).newCardLimit).toBe(3);
    expect((await repo.sync.applyRemote("settings", [row])).skipped).toBe(1);
    expect(calls).toBe(1);
  });

  it("applies every other store", async () => {
    const repo = createIndexedDbRepository(freshName());
    const t = "2026-11-10T08:00:00.000Z";
    const report = { errors: [], betterPhrases: [], newWords: [] };
    const results = await Promise.all([
      repo.sync.applyRemote("activity", [{ id: "a", block: "dinleme", startedAt: t, seconds: 120, source: "manual", updatedAt: t }]),
      repo.sync.applyRemote("videos", [{ id: "v", youtubeId: "abcdefghijk", title: "T", channel: "C", level: "orta", durationMinutes: 3, status: "todo", createdAt: t, updatedAt: t, watchedAt: null }]),
      repo.sync.applyRemote("speakingSessions", [{ id: "s", scenarioId: "cafe", startedAt: t, rawReport: report, createdAt: t, updatedAt: t }]),
      repo.sync.applyRemote("speakingErrors", [{ id: "e", sessionId: "s", category: "article", original: "a", corrected: "the", createdAt: t, updatedAt: t }]),
      repo.sync.applyRemote("reviewLogs", [{ id: "r", cardId: "c", grade: "good", reviewedAt: t, revlog: {}, previousCard: {}, updatedAt: t }]),
    ]);
    expect(results.map((r) => r.applied)).toEqual([1, 1, 1, 1, 1]);
    expect((await repo.videos.listByStatus("todo")).map((v) => v.id)).toEqual(["v"]);
    expect((await repo.speaking.listErrors("s")).map((e) => e.id)).toEqual(["e"]);
  });
});
