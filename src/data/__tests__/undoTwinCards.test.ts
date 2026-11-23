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
  it("refuses undo after a card lost a twin conflict and its log points to the winner", async () => {
    const { repo, card, log } = await reviewedCard();
    const applied = await repo.sync.applyRemote("cards", [{ ...card, id: "server-card", updatedAt: REMOTE_AT }]);
    expect(applied.conflicts).toBe(1);
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
