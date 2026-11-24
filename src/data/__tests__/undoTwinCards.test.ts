import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const REMOTE_AT = "2026-11-24T12:01:00.000Z";
const EPOCH = "1970-01-01T00:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function reviewedCard() {
  const repo = createIndexedDbRepository(`eng-learn-undo-twin-${crypto.randomUUID()}`);
  const added = await repo.inbox.add({ word: "harbor", source: { kind: "diger" } });
  if (!added.ok) throw new Error("add failed");
  const triaged = await repo.words.triage(added.item.id, "learning", NOW);
  if (!triaged.ok) throw new Error("triage failed");
  const [previous] = (await repo.cards.getReviewQueue(NOW)).cards;
  const reviewed = await repo.cards.reviewCard(previous!.card.id, "good", NOW);
  if (!reviewed.ok) throw new Error("review failed");
  return { repo, previous: previous!.card, ...reviewed };
}

describe("undo after twin adoption", () => {
  it("refuses a latest log from an offline branch when the synced card advanced from reps 2 to 4", async () => {
    const { repo, card } = await reviewedCard();
    const branchAt = new Date(NOW.getTime() + 2000);
    const branch = await repo.cards.reviewCard(card.id, "good", branchAt);
    expect(branch.ok).toBe(true);
    // The latest wall-clock review belongs to the short branch (snapshot reps 1).
    await repo.sync.applyRemote("cards", [{ ...card, reps: 4, lastReviewAt: NOW.toISOString(), updatedAt: REMOTE_AT }]);
    const before = await repo.sync.listChangedSince("cards", EPOCH);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual(before);
  });

  it("refuses a same-reps snapshot when its review time is no longer current", async () => {
    const { repo, card } = await reviewedCard();
    await repo.sync.applyRemote("cards", [{ ...card, lastReviewAt: REMOTE_AT, updatedAt: REMOTE_AT }]);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
  });

  it("undoes twice by skipping the first undone log and restoring each latest snapshot", async () => {
    const { repo, card, previous } = await reviewedCard();
    const second = await repo.cards.reviewCard(card.id, "good", new Date(NOW.getTime() + 1000));
    expect(second.ok).toBe(true);
    expect(await repo.cards.undoLastReview()).toMatchObject({ ok: true, card: { reps: 1 } });
    expect(await repo.cards.undoLastReview()).toMatchObject({ ok: true, card: { ...previous, updatedAt: expect.any(String) } });
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
  });

  it("refuses undo after a card lost a twin conflict and its log points to the winner", async () => {
    const { repo, card, log } = await reviewedCard();
    await repo.sync.applyCardMerge(card, { ...card, id: "server-card", updatedAt: REMOTE_AT });
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toMatchObject([{ id: log.id, cardId: "server-card" }]);
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual(cards);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toEqual(logs);
  });

  it("refuses undo after a word twin changed the stored card's wordId", async () => {
    const { repo, card } = await reviewedCard();
    const [word] = await repo.words.listByStatus("learning");
    expect((await repo.sync.applyRemote("words", [{ ...word, id: "server-word", updatedAt: REMOTE_AT }])).conflicts).toBe(1);
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    expect(cards).toMatchObject([{ id: card.id, wordId: "server-word" }]);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual(cards);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toEqual(logs);
  });

  it.each(["deleted", "missing"] as const)("refuses undo when the current card is %s", async (kind) => {
    const { repo, card, log } = await reviewedCard();
    if (kind === "deleted") {
      expect((await repo.sync.applyRemote("cards", [{ ...card, deletedAt: REMOTE_AT, updatedAt: REMOTE_AT }])).applied).toBe(1);
    } else {
      expect((await repo.sync.applyRemote("reviewLogs", [{ ...log, cardId: "missing-card", updatedAt: REMOTE_AT }])).applied).toBe(1);
    }
    const cards = await repo.sync.listChangedSince("cards", EPOCH);
    const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(await repo.cards.undoLastReview()).toEqual({ ok: false, reason: "nothing-to-undo" });
    expect(await repo.sync.listChangedSince("cards", EPOCH)).toEqual(cards);
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toEqual(logs);
  });

  it("still restores a normal review and tombstones its log", async () => {
    const { repo, previous, log } = await reviewedCard();
    const result = await repo.cards.undoLastReview();
    expect(result).toEqual({ ok: true, card: { ...previous, updatedAt: expect.any(String) } });
    expect(await repo.sync.listChangedSince("reviewLogs", EPOCH)).toMatchObject([{ id: log.id, deletedAt: expect.any(String) }]);
  });
});

it("undo selects the counted log when a later branch log has the same parent", async () => {
  const { repo, card, log, previous } = await reviewedCard();
  const branch = { ...log, id: crypto.randomUUID(), reviewedAt: "2026-11-24T12:00:05.000Z", updatedAt: REMOTE_AT };
  expect((await repo.sync.applyRemote("reviewLogs", [branch])).applied).toBe(1);
  // Timestamp equality is semantic, including equivalent timezone spellings.
  await repo.sync.applyRemote("cards", [{ ...card, lastReviewAt: "2026-11-24T15:00:00+03:00", updatedAt: REMOTE_AT }]);
  expect(await repo.cards.undoLastReview()).toMatchObject({ ok: true, card: { reps: previous.reps } });
  const logs = await repo.sync.listChangedSince("reviewLogs", EPOCH);
  expect(logs.find((l) => l.id === log.id)?.deletedAt).toEqual(expect.any(String));
  expect(logs.find((l) => l.id === branch.id)?.deletedAt).toBeUndefined();
});
