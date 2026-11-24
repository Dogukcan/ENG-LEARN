import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import { SYNC_STORES } from "../repository";

const NOW = "2026-11-24T12:00:00.000Z";
const FUTURE = "2099-11-25T12:00:00.000Z";
const EPOCH = "1970-01-01T00:00:00.000Z";
const freshName = () => `eng-learn-sequence-${crypto.randomUUID()}`;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("local change sequences", () => {
  it("serializes alternating and concurrent repositories on one database despite clock rollback", async () => {
    const name = freshName();
    const a = createIndexedDbRepository(name), b = createIndexedDbRepository(name);
    const input = { title: "Local", shortName: "L", unit: 1, page: 1 };
    const first = await a.books.upsert(input);
    vi.setSystemTime(Date.parse(NOW) - 5000);
    const second = await b.books.upsert(input);
    const third = await a.books.upsert(input);
    expect(second.updatedAt).toBe(new Date(Date.parse(NOW) - 5000).toISOString());
    expect(third.updatedAt).toBe(second.updatedAt);
    await Promise.all([a.books.upsert(input), b.books.upsert(input)]);
    const rows = await a.sync.listChangedAfterSeq("books", 0);
    expect(rows.map((r) => r.localSeq)).toEqual([1, 2, 3, 4, 5]);
    expect((await b.sync.listChangedAfterSeq("books", 1)).map((r) => r.id)).toContain(second.id);
    await b.books.setPosition(first.id, { unit: 2, page: 2 });
    expect((await a.sync.listChangedAfterSeq("books", 5)).map((r) => r.localSeq)).toEqual([6]);
    expect((await createIndexedDbRepository(name).sync.listChangedAfterSeq("books", 5))[0]?.localSeq).toBe(6);
  });

  it("does not let future server rows change unrelated local stamps or become local changes", async () => {
    const repo = createIndexedDbRepository(freshName());
    const remote = { id: "remote", title: "Remote", shortName: "R", unit: 1, page: 1, updatedAt: FUTURE };
    await repo.sync.applyRemote("books", [remote]);
    expect(await repo.sync.listChangedAfterSeq("books", 0)).toEqual([]);
    const added = await repo.books.upsert({ ...remote, id: undefined });
    expect(added.updatedAt).toBe(NOW);
    const [before] = await repo.sync.listChangedAfterSeq("books", 0);
    await repo.sync.applyRemote("books", [{ ...added, localSeq: 999, updatedAt: FUTURE }]);
    expect((await repo.sync.listChangedAfterSeq("books", 0))[0]?.localSeq).toBe(before.localSeq);
  });

  it.each(["bundle", "merge"] as const)("preserves local sequences on %s server replies", async (reply) => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.inbox.add({ word: "reply", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");
    await repo.words.triage(added.item.id, "learning", new Date());
    const [sent] = await repo.sync.listChangedAfterSeq("cards", 0);
    const canonical = { ...sent, updatedAt: FUTURE, localSeq: 999 };
    if (reply === "bundle") await repo.sync.applyCardBundle!({ cards: [sent], reviewLogs: [] }, canonical, []);
    else await repo.sync.applyCardMerge(sent, canonical);
    expect((await repo.sync.listChangedAfterSeq("cards", 0))[0]?.localSeq).toBe(sent.localSeq);
    expect((await repo.books.upsert({ title: "Local", shortName: "L", unit: 1, page: 1 })).updatedAt).toBe(NOW);
  });

  it("sequences creation, review, undo, tombstones, settings and speaking writes in every store", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.books.upsert({ title: "Local", shortName: "L", unit: 1, page: 1 });
    const added = await repo.inbox.add({ word: "learn", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");
    expect((await repo.words.triage(added.item.id, "learning", new Date())).ok).toBe(true);
    const [card] = await repo.sync.listChangedSince("cards", EPOCH);
    expect((await repo.cards.reviewCard(card.id, "good", new Date())).ok).toBe(true);
    expect((await repo.cards.undoLastReview()).ok).toBe(true);
    await repo.settings.update({ newCardLimit: 10 });
    const video = await repo.videos.add({ youtubeId: "monotonic", title: "Video", channel: "Channel", level: "orta", durationMinutes: 2 });
    if (!video.ok) throw new Error("video failed");
    await repo.videos.markWatched(video.video.id);
    await repo.videos.undoWatched(video.video.id);
    await repo.videos.remove(video.video.id);
    await repo.speaking.saveReport({ scenarioId: "cafe", startedAt: NOW }, {
      errors: [{ category: "article", original: "a apple", corrected: "an apple" }],
      betterPhrases: [], newWords: [{ word: "speaking" }], summary: "ok",
    });
    for (const store of SYNC_STORES) {
      const rows = await repo.sync.listChangedAfterSeq(store, 0);
      expect(rows.length, store).toBeGreaterThan(0);
      expect(rows.every((r) => Number.isSafeInteger(r.localSeq) && r.localSeq! > 0), store).toBe(true);
      expect(new Set(rows.map((r) => r.localSeq)).size).toBe(rows.length);
    }
    expect((await repo.sync.listChangedAfterSeq("reviewLogs", 0))[0]?.localSeq).toBe(2);
    expect((await repo.sync.listChangedAfterSeq("videos", 0))[0]?.localSeq).toBe(4);
  });

  it("keeps allocating beyond a settled cursor after the maximum-sequence card is merged away", async () => {
    const repo = createIndexedDbRepository(freshName());
    const add = async (word: string) => {
      const added = await repo.inbox.add({ word, source: { kind: "diger" } });
      if (!added.ok) throw new Error("add failed");
      await repo.words.triage(added.item.id, "learning", new Date());
      return (await repo.sync.listChangedAfterSeq("cards", 0)).find((r) => !r.deletedAt && r.wordId !== "canonical-word")!;
    };
    const loser = await add("loser");
    const cursor = loser.localSeq!;
    await repo.sync.applyCardMerge(loser, { ...loser, id: "canonical", wordId: "canonical-word", updatedAt: FUTURE });
    await add("later");
    expect((await repo.sync.listChangedAfterSeq("cards", cursor)).map((r) => r.localSeq)).toEqual([cursor + 1]);
  });

  it.each([-60000, 60000])("preserves the upgrade boundary across later writes and reopen with clock offset %i", async (offset) => {
    const name = freshName();
    const raw = await openDB(name, 5, { upgrade(db) {
      for (const store of SYNC_STORES) {
        db.createObjectStore(store, store === "settings" ? undefined : { keyPath: "id" })
          .createIndex("by-updatedAt", "updatedAt");
      }
    } });
    await raw.put("books", { id: "settled", title: "Settled", shortName: "S", unit: 1, page: 1, updatedAt: NOW });
    await raw.put("books", { id: "pending", title: "Pending", shortName: "P", unit: 1, page: 2, updatedAt: FUTURE });
    raw.close();
    vi.setSystemTime(Date.parse(NOW) + offset);
    const repo = createIndexedDbRepository(name);
    const later = await repo.books.upsert({ title: "Later", shortName: "L", unit: 1, page: 3 });
    expect(await repo.sync.upgradeMaxLocalSeq("books")).toBe(2);
    expect(await repo.sync.upgradeMaxLocalSeq("inbox")).toBe(0);
    expect(await createIndexedDbRepository(name).sync.upgradeMaxLocalSeq("books")).toBe(2);
    // Conversion only considers upgrade rows, even when a later write's clock is behind.
    expect(await repo.sync.maxLocalSeqThrough("books", NOW)).toBe(1);
    expect(await repo.sync.maxLocalSeqThrough("books", FUTURE)).toBe(2);
    expect((await repo.sync.listChangedAfterSeq("books", 1)).map((r) => r.id)).toEqual(["pending", later.id]);
    expect((await repo.sync.listChangedAfterSeq("books", 2)).map((r) => r.id)).toEqual([later.id]);
  });

  it("records no upgrade boundaries for a fresh v6 database, even after local writes", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    await repo.books.upsert({ title: "Fresh", shortName: "F", unit: 1, page: 1 });
    for (const store of SYNC_STORES) {
      expect(await repo.sync.upgradeMaxLocalSeq(store), store).toBeNull();
      expect(await repo.sync.maxLocalSeqThrough(store, FUTURE), store).toBe(0);
    }
    expect(await createIndexedDbRepository(name).sync.upgradeMaxLocalSeq("books")).toBeNull();
    const raw = await openDB(name);
    expect(await raw.count("syncMeta")).toBe(0);
    raw.close();
  });

  it("upgrades v5 rows in every store in updatedAt order without deleting data", async () => {
    const name = freshName();
    const raw = await openDB(name, 5, { upgrade(db) {
      for (const name of SYNC_STORES) {
        const store = db.createObjectStore(name, name === "settings" ? undefined : { keyPath: "id" });
        store.createIndex("by-updatedAt", "updatedAt");
      }
    } });
    for (const store of SYNC_STORES) {
      for (const [id, time] of [["z", NOW], ["a", EPOCH], ["d", FUTURE]]) {
        await raw.put(store, { id, updatedAt: time, deletedAt: time, payload: `${store}-${id}` }, store === "settings" ? id : undefined);
      }
    }
    raw.close();
    const repo = createIndexedDbRepository(name);
    for (const store of SYNC_STORES) {
      const rows = await repo.sync.listChangedAfterSeq(store, 0);
      expect(rows.map((r) => r.localSeq), store).toEqual([1, 2, 3]);
      expect(await repo.sync.upgradeMaxLocalSeq(store), store).toBe(3);
      expect(await repo.sync.maxLocalSeqThrough(store, "1969-01-01T00:00:00.000Z")).toBe(0);
      expect(await repo.sync.maxLocalSeqThrough(store, EPOCH)).toBe(1);
      expect(await repo.sync.maxLocalSeqThrough(store, NOW)).toBe(2);
      expect(await repo.sync.maxLocalSeqThrough(store, FUTURE)).toBe(3);
      if (store !== "settings") expect(rows.map((r) => r.id)).toEqual(["a", "z", "d"]);
    }
    const upgraded = await openDB(name);
    expect(upgraded.version).toBe(6);
    for (const store of SYNC_STORES) {
      expect(await upgraded.get("syncMeta", store)).toEqual({ upgradeMaxSeq: 3 });
      expect((await upgraded.getAll(store)).map((r) => r.payload).sort()).toEqual([`${store}-a`, `${store}-d`, `${store}-z`]);
      expect(upgraded.transaction(store).store.indexNames.contains("by-localSeq")).toBe(true);
    }
    upgraded.close();
  });
});
