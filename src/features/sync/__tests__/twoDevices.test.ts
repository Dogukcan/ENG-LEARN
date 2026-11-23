import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TABLES, fromRemoteRow } from "../mapping";
import { LOCAL_TIME, USER_ID, createDevice, createSharedServer, createTwoDevices, syncRound } from "./twoDevices";

const EPOCH = "1970-01-01T00:00:00.000Z";

type Device = ReturnType<typeof createDevice>;

async function learn(device: Device, lemma: string, reps: number) {
  return device.run(async () => {
    const { repo } = device;
    const added = await repo.inbox.add({ word: lemma, source: { kind: "diger" } });
    if (!added.ok) throw new Error(`add failed: ${added.reason}`);
    const triaged = await repo.words.triage(added.item.id, "learning", device.now());
    if (!triaged.ok) throw new Error(`triage failed: ${triaged.reason}`);
    const card = (await repo.sync.listChangedSince("cards", EPOCH)).find((row) => row.wordId === triaged.word.id)!;
    for (let i = 0; i < reps; i++) {
      const reviewed = await repo.cards.reviewCard(card.id, "good", device.now());
      if (!reviewed.ok) throw new Error("review failed");
      device.advance(100);
      vi.setSystemTime(device.now());
    }
    return { wordId: triaged.word.id, cardId: card.id };
  });
}

async function reviewIds(devices: Device[]) {
  const logs = await Promise.all(devices.map((d) => d.repo.sync.listChangedSince("reviewLogs", EPOCH)));
  return [...new Set(logs.flat().map((log) => log.id))].sort();
}

async function expectConverged(devices: Device[], server: ReturnType<typeof createSharedServer>, cardId: string, logIds: string[]) {
  for (const device of devices) {
    expect(device.engine.getState().status).toBe("idle");
    const cards = (await device.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
    expect(cards.map((card) => card.id)).toEqual([cardId]);
    const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs.map((log) => log.id).sort()).toEqual(logIds);
    expect(logs.every((log) => !log.deletedAt && log.cardId === cardId)).toBe(true);
  }
  const cards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
  expect(cards.map((card) => card.id)).toEqual([cardId]);
  const logs = [...server.tableOf("eng_review_logs").values()];
  expect(logs.map((log) => log.id).sort()).toEqual(logIds);
  expect(logs.every((log) => log.deleted_at == null && log.card_id === cardId)).toBe(true);
}

async function reviewMore(device: Device, cardId: string, count: number) {
  await device.run(async () => {
    for (let i = 0; i < count; i++) {
      expect((await device.repo.cards.reviewCard(cardId, "good", device.now())).ok).toBe(true);
      device.advance(100);
      vi.setSystemTime(device.now());
    }
  });
}

beforeEach(() => {
  // Repository writes use Date directly. Keep those writes and both engine clocks deterministic.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LOCAL_TIME);
});
afterEach(() => vi.useRealTimers());

describe("two devices sharing a Supabase server", () => {
  it("copies a word from A to B through a full sync round", async () => {
    const { a, b } = createTwoDevices();
    const word = await learn(a, "harbor", 0);
    await syncRound(a);
    await syncRound(b);
    expect(await b.repo.words.listByStatus("learning")).toMatchObject([{ id: word.wordId, lemma: "harbor" }]);
  });

  it("seed books do not overwrite progress on a fresh second device", async () => {
    const { a, b } = createTwoDevices();
    const rw1 = (await a.repo.books.list()).find((book) => book.shortName === "RW1")!;
    await a.run(() => a.repo.books.setPosition(rw1.id, { unit: 4, page: 37 }));
    await syncRound(a);
    await syncRound(b);
    await syncRound(b);
    await syncRound(a);
    for (const device of [a, b]) expect(await device.repo.books.get(rw1.id)).toMatchObject({ unit: 4, page: 37 });
  });

  it.each([
    { name: "server card has more reps", aReps: 3, bReps: 1, skewMs: 0 },
    { name: "documented limitation: server card wins even with fewer reps", aReps: 1, bReps: 3, skewMs: 0 },
    { name: "tie keeps the server card", aReps: 1, bReps: 1, skewMs: 0 },
    { name: "loser clock 5 s behind server", aReps: 1, bReps: 3, skewMs: -5000 },
    { name: "loser clock 5 s ahead of server", aReps: 1, bReps: 3, skewMs: 5000 },
  ] as const)("twin word: $name, preserving every review log", async ({ aReps, bReps, skewMs }) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const first = await learn(a, "harbor", aReps);
    await syncRound(a);
    const second = await learn(b, "Harbor", bReps);
    const originalCard = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const logIds = await reviewIds([a, b]);
    expect(second.wordId).not.toBe(first.wordId);
    expect(second.cardId).not.toBe(first.cardId);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    const winnerId = first.cardId;
    for (const device of [a, b]) {
      const words = await device.repo.words.listByStatus("learning");
      expect(words).toHaveLength(1);
      expect(words[0]?.id).toBe(first.wordId);
      const cards = (await device.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ id: winnerId, wordId: first.wordId, reps: aReps });
      expect(cards[0]).toMatchObject({ ...originalCard, wordId: first.wordId, updatedAt: expect.any(String) });
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs).toHaveLength(aReps + bReps);
      expect(logs.every((log) => log.cardId === winnerId)).toBe(true);
    }
    const liveServerCards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
    expect(liveServerCards).toMatchObject([{ id: winnerId, reps: aReps }]);
    await expectConverged([a, b], server, winnerId, logIds);
  });

  it("keeps a word, its card and all logs intact when there is no twin", async () => {
    const { a, b } = createTwoDevices();
    const original = await learn(a, "harbor", 2);
    const originalLogs = await a.repo.sync.listChangedSince("reviewLogs", EPOCH);
    await syncRound(a);
    await syncRound(b);
    await syncRound(a);
    for (const device of [a, b]) {
      expect(await device.repo.words.listByStatus("learning")).toMatchObject([{ id: original.wordId }]);
      expect(await device.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ id: original.cardId, wordId: original.wordId, reps: 2 }]);
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs.map((log) => log.id).sort()).toEqual(originalLogs.map((log) => log.id).sort());
      expect(logs.every((log) => log.cardId === original.cardId)).toBe(true);
    }
  });

  it.each([
    { aReps: 3, bReps: 1, winner: "a" },
    { aReps: 1, bReps: 3, winner: "b" },
  ] as const)("moves logs when the surviving word's card is already local ($winner wins)", async ({ aReps, bReps, winner }) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", aReps);
    const second = await learn(b, "Harbor", bReps);
    await syncRound(a);
    // A partial download can deliver the surviving word's card and logs before its word.
    await b.run(() => b.repo.sync.applyRemote("cards", [...server.tableOf("eng_cards").values()].map((row) => fromRemoteRow("cards", row))));
    await b.run(() => b.repo.sync.applyRemote("reviewLogs", [...server.tableOf("eng_review_logs").values()].map((row) => fromRemoteRow("reviewLogs", row))));
    const before = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    await b.run(() => b.repo.sync.applyRemote("words", [...server.tableOf("eng_words").values()].map((row) => fromRemoteRow("words", row))));
    const winnerId = winner === "a" ? first.cardId : second.cardId;
    const loserId = winner === "a" ? second.cardId : first.cardId;
    const logs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs).toHaveLength(aReps + bReps);
    expect(logs.every((log) => log.cardId === winnerId)).toBe(true);
    for (const old of before.filter((log) => log.cardId === loserId)) {
      expect(logs.find((log) => log.id === old.id)!.updatedAt > old.updatedAt).toBe(true);
    }
    const cards = (await b.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
    expect(cards).toMatchObject([{ id: winnerId, wordId: first.wordId, reps: Math.max(aReps, bReps) }]);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    for (const device of [a, b]) {
      const syncedLogs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(syncedLogs).toHaveLength(aReps + bReps);
      expect(syncedLogs.every((log) => log.cardId === first.cardId)).toBe(true);
    }
  });

  it("preserves the server twin owner's unpushed offline reviews", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await reviewMore(a, first.cardId, 2);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    expect(logIds).toHaveLength(6);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    await expectConverged([a, b], server, first.cardId, logIds);
  });

  it("converges three devices including offline reviews of the server card", async () => {
    const { a, b, server } = createTwoDevices();
    const c = createDevice(server);
    const first = await learn(a, "harbor", 1);
    await learn(b, "Harbor", 3);
    await syncRound(a);
    await syncRound(c);
    await reviewMore(c, first.cardId, 2);
    const logIds = await reviewIds([a, b, c]);
    expect(logIds).toHaveLength(6);
    for (let i = 0; i < 2; i++) {
      for (const device of [b, a, c]) await syncRound(device);
    }
    await expectConverged([a, b, c], server, first.cardId, logIds);
  });

  it("leaves the server unchanged and pendingCount zero for two extra rounds after convergence", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds);
    const snapshot = () => Object.values(TABLES).map(({ table }) => [table, [...server.tableOf(table).values()]]);
    const before = structuredClone(snapshot());
    for (let i = 0; i < 2; i++) {
      for (const device of [a, b]) {
        await syncRound(device);
        expect(device.engine.getState().pendingCount).toBe(0);
      }
      expect(snapshot()).toEqual(before);
    }
    await expectConverged([a, b], server, first.cardId, logIds);
  });

  it("keeps B consistent with server deletion before its twin push without a counted orphan", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    server.advance(1000);
    for (const [table, id] of [["eng_cards", first.cardId], ["eng_words", first.wordId]]) {
      const at = server.now().toISOString();
      const row = server.tableOf(table!).get(id!)!;
      expect((await server.client.from(table!).upsert([
        { ...row, deleted_at: at, client_updated_at: at },
      ], { onConflict: "id" })).error).toBeNull();
    }
    for (const device of [b, a, b]) await syncRound(device);
    const serverWords = [...server.tableOf("eng_words").values()].filter((row) => row.deleted_at == null);
    const words = await b.repo.words.listByStatus("learning");
    expect(words.map((word) => word.id).sort()).toEqual(serverWords.map((word) => word.id).sort());
    const queue = await b.repo.cards.getReviewQueue(new Date("2027-11-24T12:00:00Z"));
    expect(queue.cards.every(({ word }) => serverWords.some((row) => row.id === word.id))).toBe(true);
    const liveCards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
    expect(queue.cards.map(({ card }) => card.id).sort()).toEqual(liveCards.map((row) => row.id).sort());
    expect(queue.dueTotal).toBe(liveCards.length);
  });
});

describe("shared server SQL behavior", () => {
  it("stamps all rows in each upsert or update once, advancing 1 ms per statement", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    server.advance(2000);
    const firstAt = server.now().toISOString();
    expect((await query.upsert([{ id: "one" }, { id: "two" }], { onConflict: "id" })).error).toBeNull();
    expect([...server.tableOf("eng_review_logs").values()].map((row) => row.updated_at)).toEqual([firstAt, firstAt]);
    expect(server.now().getTime()).toBe(Date.parse(firstAt) + 1);
    const secondAt = server.now().toISOString();
    expect((await query.update({ card_id: "winner" })).error).toBeNull();
    expect([...server.tableOf("eng_review_logs").values()].map((row) => row.updated_at)).toEqual([secondAt, secondAt]);
    expect(server.now().getTime()).toBe(Date.parse(secondAt) + 1);
  });

  it("rejects duplicate ids in one upsert with 21000 without writing any rows", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    expect((await query.upsert([{ id: "old", card_id: "original" }], { onConflict: "id" })).error).toBeNull();
    const before = structuredClone([...server.tableOf("eng_review_logs").values()]);
    const at = server.now().getTime();
    const result = await query.upsert([{ id: "new" }, { id: "old" }, { id: "old" }], { onConflict: "id" });
    expect(result.error?.code).toBe("21000");
    expect([...server.tableOf("eng_review_logs").values()]).toEqual(before);
    expect(server.now().getTime()).toBe(at + 1);
  });

  it.each([
    { table: "eng_inbox", column: "normalized" },
    { table: "eng_words", column: "normalized" },
    { table: "eng_cards", column: "word_id" },
    { table: "eng_videos", column: "youtube_id" },
  ])("enforces the $table partial unique key atomically and per user", async ({ table, column }) => {
    const server = createSharedServer();
    const query = server.client.from(table);
    const rows = server.tableOf(table);
    rows.set("foreign", { id: "foreign", user_id: "another-user", [column]: "same", updated_at: EPOCH });
    expect((await query.upsert([{ id: "first", [column]: "same" }], { onConflict: "id" })).error).toBeNull();
    const stored = structuredClone(server.tableOf(table).get("first"));
    const refused = await query.upsert([
      { id: "unrelated", [column]: "different" }, { id: "twin", [column]: "same" },
    ], { onConflict: "id" });
    expect(refused.error?.code).toBe("23505");
    expect(server.tableOf(table).has("unrelated")).toBe(false);
    expect(server.tableOf(table).has("twin")).toBe(false);
    expect(server.tableOf(table).get("first")).toEqual(stored);
    expect((await query.upsert([{ id: "dead", [column]: "same", deleted_at: server.now().toISOString() }], { onConflict: "id" })).error).toBeNull();
    const visible = await query.select("*").eq(column, "same");
    expect(visible.data?.map((row) => row.id).sort()).toEqual(["dead", "first"]);
    expect(visible.data?.every((row) => row.user_id === USER_ID)).toBe(true);
    expect(String(server.tableOf(table).get("dead")!.updated_at) > String(stored!.updated_at)).toBe(true);
  });

  it("silently preserves OLD on stale upserts and updates, comparing against server updated_at", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    await query.upsert([{ id: "log", card_id: "first", client_updated_at: EPOCH }], { onConflict: "id" });
    const old = structuredClone(server.tableOf("eng_review_logs").get("log"))!;
    // Newer than the old client edit, but older than the server stamp: it must still be refused.
    const stale = { card_id: "stale", client_updated_at: LOCAL_TIME.toISOString() };
    expect((await query.upsert([{ id: "log", ...stale }], { onConflict: "id" })).error).toBeNull();
    expect((await query.update(stale).eq("card_id", "first")).error).toBeNull();
    expect(server.tableOf("eng_review_logs").get("log")).toEqual(old);
    expect((await query.update({ card_id: "winner", client_updated_at: String(old.updated_at) }).eq("card_id", "first")).error).toBeNull();
    const updated = server.tableOf("eng_review_logs").get("log")!;
    expect(updated.card_id).toBe("winner");
    expect(String(updated.updated_at) > String(old.updated_at)).toBe(true);
  });
});
