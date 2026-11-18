// Tests for the fixed seed book ids, the v4 -> v5 merge of random-id copies, and clearLocalData.
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";

const freshName = () => `eng-learn-seed-test-${crypto.randomUUID()}`;

/** Build a version 4 database by hand, the way a device that already synced would have it. */
async function makeV4(
  name: string,
  data: { books: object[]; inbox?: object[]; settings?: object },
): Promise<void> {
  const v4 = await openDB(name, 4, {
    upgrade(database) {
      const stores: [string, Array<[string, string, boolean]>][] = [
        ["books", []],
        ["inbox", [["by-normalized", "normalized", true], ["by-createdAt", "createdAt", false]]],
        ["words", [["by-normalized", "normalized", true], ["by-status", "status", false]]],
        ["activity", [["by-startedAt", "startedAt", false]]],
        ["cards", [["by-wordId", "wordId", true], ["by-due", "dueAt", false]]],
        ["reviewLogs", [["by-reviewedAt", "reviewedAt", false], ["by-cardId", "cardId", false]]],
        ["videos", [["by-youtubeKey", "youtubeKey", true], ["by-status", "status", false]]],
        ["speakingSessions", [["by-startedAt", "startedAt", false]]],
        ["speakingErrors", [["by-sessionId", "sessionId", false]]],
      ];
      for (const [storeName, indexes] of stores) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        for (const [indexName, keyPath, unique] of indexes) store.createIndex(indexName, keyPath, { unique });
        store.createIndex("by-updatedAt", "updatedAt");
      }
      const settings = database.createObjectStore("settings");
      settings.createIndex("by-updatedAt", "updatedAt");
    },
  });
  for (const book of data.books) await v4.put("books", book);
  for (const item of data.inbox ?? []) await v4.put("inbox", item);
  if (data.settings) await v4.put("settings", data.settings, "app");
  v4.close();
}

const book = (id: string, shortName: string, page: number, updatedAt: string, extra: object = {}) => ({
  id, title: `Reader at Work ${shortName.slice(2)}`, shortName, unit: 1, page, updatedAt, ...extra,
});

describe("seed books", () => {
  it("a brand-new database holds the fixed ids", async () => {
    const repo = createIndexedDbRepository(freshName());
    const ids = (await repo.books.list()).map((b) => b.id);
    expect(ids).toEqual(["seed-rw1", "seed-rw2"]);
  });

  it("two devices that start fresh produce the same ids, so they cannot double up", async () => {
    const a = (await createIndexedDbRepository(freshName()).books.list()).map((b) => b.id);
    const b = (await createIndexedDbRepository(freshName()).books.list()).map((b) => b.id);
    expect(a).toEqual(b);
  });
});

describe("upgrade v4 -> v5", () => {
  it("merges random-id copies into the fixed row and re-points references", async () => {
    const name = freshName();
    await makeV4(name, {
      books: [
        book("old-1", "RW1", 40, "2026-11-10T10:00:00.000Z"),
        book("old-2", "RW2", 3, "2026-11-10T10:00:00.000Z"),
        book("other-1", "RW1", 7, "2026-11-12T10:00:00.000Z"),
      ],
      inbox: [{
        id: "i1", word: "harbor", normalized: "harbor", createdAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z", source: { kind: "kitap", bookId: "old-1", page: 4 },
      }],
      settings: { id: "app", activeBookId: "old-1", updatedAt: "2026-11-10T10:00:00.000Z" },
    });
    const repo = createIndexedDbRepository(name);
    const books = await repo.books.list();
    expect(books.map((b) => b.id)).toEqual(["seed-rw1", "seed-rw2"]);
    // other-1 was the most recent write for RW1, so its page wins.
    expect(books[0]?.page).toBe(7);
    expect(books[1]?.page).toBe(3);
    expect((await repo.settings.get()).activeBookId).toBe("seed-rw1");
    const inbox = await repo.inbox.list();
    expect(inbox[0]?.source).toEqual({ kind: "kitap", bookId: "seed-rw1", page: 4 });
    // The merged copies are tombstones that sync can send, not hard deletes.
    const rows = await repo.sync.listChangedSince("books", "1970-01-01T00:00:00.000Z");
    expect(rows.filter((r) => typeof r.deletedAt === "string").map((r) => r.id).sort()).toEqual(["old-1", "old-2", "other-1"]);
  });

  it("a v4 device that already has the fixed ids is left alone", async () => {
    const name = freshName();
    await makeV4(name, { books: [book("seed-rw1", "RW1", 9, "2026-11-10T10:00:00.000Z"), book("seed-rw2", "RW2", 2, "2026-11-10T10:00:00.000Z")] });
    const repo = createIndexedDbRepository(name);
    expect((await repo.books.list()).map((b) => [b.id, b.page])).toEqual([["seed-rw1", 9], ["seed-rw2", 2]]);
    const rows = await repo.sync.listChangedSince("books", "2026-11-10T10:00:00.000Z");
    expect(rows).toEqual([]);
  });
});

describe("books from a device that has not upgraded", () => {
  it("applyRemote merges a random-id RW1 copy into the fixed row", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.books.list();
    const future = "2999-01-01T00:00:00.000Z";
    await repo.sync.applyRemote("books", [book("random-9", "RW1", 55, future)]);
    const books = await repo.books.list();
    expect(books.map((b) => b.id)).toEqual(["seed-rw1", "seed-rw2"]);
    expect(books[0]?.page).toBe(55);
  });
});

describe("clearLocalData", () => {
  it("removes everything, keeps only the fixed seed books and notifies", async () => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.inbox.add({ word: "harbor", source: { kind: "diger" } });
    expect(added.ok).toBe(true);
    await repo.activity.add({ block: "okuma", startedAt: new Date().toISOString(), seconds: 60, source: "timer" });
    await repo.settings.update({ newCardLimit: 3 });
    let heard = 0;
    repo.subscribe(() => { heard += 1; });
    await repo.sync.clearLocalData();
    expect(heard).toBe(1);
    expect(await repo.inbox.list()).toEqual([]);
    expect((await repo.settings.get()).newCardLimit).toBe(10);
    expect((await repo.books.list()).map((b) => b.id)).toEqual(["seed-rw1", "seed-rw2"]);
    expect(await repo.sync.listChangedSince("activity", "1970-01-01T00:00:00.000Z")).toEqual([]);
  });
});
