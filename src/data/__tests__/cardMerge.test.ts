import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";

const EPOCH = "1970-01-01T00:00:00.000Z";
const NOW = new Date("2026-11-24T12:00:00.000Z");
const SERVER_AT = "2026-11-24T12:01:00.000Z";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

async function fixture() {
  const repo = createIndexedDbRepository(`eng-learn-merge-${crypto.randomUUID()}`);
  const added = await repo.inbox.add({ word: "harbor", source: { kind: "diger" } });
  if (!added.ok) throw new Error("add failed");
  const triaged = await repo.words.triage(added.item.id, "learning", NOW);
  if (!triaged.ok) throw new Error("triage failed");
  const first = (await repo.cards.getReviewQueue(NOW)).cards[0]!.card;
  const reviewed = await repo.cards.reviewCard(first.id, "good", NOW);
  if (!reviewed.ok) throw new Error("review failed");
  const sent = { ...reviewed.card };
  const canonical = { ...sent, id: "canonical", reps: 4, updatedAt: SERVER_AT };
  return { repo, sent, canonical, log: reviewed.log };
}

describe("applyCardMerge", () => {
  it("removes the unchanged loser, writes server state and moves logs atomically", async () => {
    const { repo, sent, canonical, log } = await fixture();
    let notifications = 0;
    repo.subscribe(() => notifications++);
    await repo.sync.applyCardMerge(sent, canonical);
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual([canonical]);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toMatchObject([{ id: log.id, cardId: canonical.id }]);
    expect(notifications).toBe(1);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
  });

  it("preserves an in-flight review, rekeys it and leaves a stamp after both versions", async () => {
    const { repo, sent, canonical } = await fixture();
    const reviewed = await repo.cards.reviewCard(sent.id, "again", new Date(NOW.getTime() + 1000));
    if (!reviewed.ok) throw new Error("review failed");
    await repo.sync.applyCardMerge(sent, canonical);
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    expect(cards).toEqual([{ ...reviewed.card, id: canonical.id, updatedAt: expect.any(String) }]);
    expect(cards[0]!.updatedAt > canonical.updatedAt).toBe(true);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.cardId === canonical.id)).toBe(true);
  });

  it("writes the canonical same-id row directly (selected insert path)", async () => {
    const { repo, sent, canonical } = await fixture();
    await repo.sync.applyCardMerge(sent, { ...canonical, id: sent.id });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual([{ ...canonical, id: sent.id }]);
    expect((await repo.sync.listChangedSince("reviewLogs", EPOCH))[0]!.cardId).toBe(sent.id);
  });

  it("rejects invalid canonical rows before changing either store", async () => {
    const { repo, sent } = await fixture();
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    await expect(repo.sync.applyCardMerge(sent, { id: "bad", updatedAt: SERVER_AT })).rejects.toThrow("Invalid canonical card");
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual([sent]);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toEqual(logs);
  });

  it("rolls back card removal and log movement if the canonical unique key cannot be written", async () => {
    const { repo, sent, canonical } = await fixture();
    await repo.sync.applyRemote("cards", [{ ...canonical, wordId: "other-word", id: "occupied" }]);
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    await expect(repo.sync.applyCardMerge(sent, { ...canonical, wordId: "other-word" })).rejects.toThrow();
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual(cards);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toEqual(logs);
  });
});

describe("card pull reconciliation", () => {
  it("defers a live twin and makes a previously settled local candidate pending", async () => {
    const { repo, sent, canonical } = await fixture();
    const result = await repo.sync.applyRemote("cards", [canonical]);
    expect(result).toMatchObject({ applied: 0, skipped: 1, conflicts: 1 });
    const cards = await repo.sync.listChangedSince("cards", sent.updatedAt);
    expect(cards).toMatchObject([{ id: sent.id, reps: sent.reps }]);
    expect(cards[0]!.updatedAt > canonical.updatedAt).toBe(true);
    expect((await repo.sync.listChangedSince("reviewLogs", EPOCH))[0]!.cardId).toBe(sent.id);
  });

  it("takes higher reps for the same id even with an older timestamp", async () => {
    const { repo, sent } = await fixture();
    const remote = { ...sent, reps: 5, updatedAt: EPOCH };
    expect(await repo.sync.applyRemote("cards", [remote])).toMatchObject({ applied: 1 });
    // EPOCH is excluded by listChangedSince, so query the review queue instead.
    expect((await repo.cards.getReviewQueue(new Date("2030-01-01"))).cards[0]!.card.reps).toBe(5);
  });

  it("still replaces a local tombstone with a remote live twin and moves logs", async () => {
    const { repo, sent, canonical } = await fixture();
    await repo.sync.applyRemote("cards", [{ ...sent, deletedAt: SERVER_AT, updatedAt: SERVER_AT }]);
    expect(await repo.sync.applyRemote("cards", [canonical])).toMatchObject({ applied: 1, conflicts: 1 });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual([canonical]);
    expect((await repo.sync.listChangedSince("reviewLogs", EPOCH))[0]!.cardId).toBe(canonical.id);
  });
});
