// Tests for cards of words that lose a unique-twin conflict, and for the review queue skipping
// cards whose word is gone.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import type { Repository } from "../repository";

const freshName = () => `eng-learn-twin-test-${crypto.randomUUID()}`;
const NOW = new Date(2026, 10, 17, 10, 0);
const LATER = new Date(2026, 10, 20, 10, 0);
const EPOCH = "1970-01-01T00:00:00.000Z";
// Far newer than anything the local repo stamps with the real clock.
const REMOTE_AT = "2099-01-01T00:00:00.000Z";

async function learn(repo: Repository, word: string) {
  const added = await repo.inbox.add({ word, source: { kind: "diger" } });
  if (!added.ok) throw new Error("add failed");
  const triaged = await repo.words.triage(added.item.id, "learning", NOW);
  if (!triaged.ok) throw new Error("triage failed");
  return triaged.word;
}

const remoteWord = (id: string, lemma: string, over: Record<string, unknown> = {}) => ({
  id, lemma, status: "learning", source: { kind: "diger" },
  createdAt: "2026-11-10T08:00:00.000Z", updatedAt: REMOTE_AT, ...over,
});

/** Every card row, tombstones included (listChangedSince lists soft-deleted rows too). */
async function allCards(repo: Repository) {
  return (await repo.sync.listChangedSince("cards", EPOCH)) as Array<Record<string, unknown>>;
}

describe("word twin adoption and cards", () => {
  it("re-points the card of the losing word to the surviving word, keeping its FSRS state", async () => {
    const repo = createIndexedDbRepository(freshName());
    const local = await learn(repo, "harbor");
    const queue = await repo.cards.getReviewQueue(LATER);
    const card = queue.cards[0]!.card;
    const reviewed = await repo.cards.reviewCard(card.id, "good", LATER);
    if (!reviewed.ok) throw new Error("review failed");

    const result = await repo.sync.applyRemote("words", [remoteWord("w-remote", "Harbor")]);
    expect(result.conflicts).toBe(1);

    const cards = await allCards(repo);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: card.id,
      wordId: "w-remote",
      reps: reviewed.card.reps,
      stability: reviewed.card.stability,
    });
    expect(cards[0]).not.toHaveProperty("deletedAt");
    // The card is in the queue again, with the surviving word. The local word is dead.
    expect(local.id).not.toBe("w-remote");
    const after = await repo.cards.getReviewQueue(new Date(2026, 11, 30));
    expect(after.cards.map((c) => [c.card.id, c.word.id])).toEqual([[card.id, "w-remote"]]);
    expect(after.dueTotal).toBe(1);
  });

  it("keeps the survivor's live card when it has at least as many reps, and tombstones the other", async () => {
    const repo = createIndexedDbRepository(freshName());
    await learn(repo, "harbor");
    const deadCard = (await allCards(repo))[0]!;
    await repo.cards.reviewCard(deadCard.id as string, "good", LATER);
    const dead = (await allCards(repo))[0]!; // reps 1
    // The survivor's card arrives first, with more reps.
    await repo.sync.applyRemote("cards", [{ ...dead, id: "c-remote", wordId: "w-remote", reps: 3, updatedAt: REMOTE_AT }]);
    await repo.sync.applyRemote("words", [remoteWord("w-remote", "harbor")]);

    const cards = await allCards(repo);
    const byId = new Map(cards.map((c) => [c.id as string, c]));
    expect(byId.get("c-remote")).not.toHaveProperty("deletedAt");
    expect(byId.get("c-remote")?.wordId).toBe("w-remote");
    expect(typeof byId.get(dead.id as string)?.deletedAt).toBe("string");
  });

  it("moves the losing word's card over when it has more reps than the survivor's card", async () => {
    const repo = createIndexedDbRepository(freshName());
    await learn(repo, "harbor");
    const first = (await allCards(repo))[0]!;
    await repo.cards.reviewCard(first.id as string, "good", LATER);
    const dead = (await allCards(repo))[0]!; // reps 1
    await repo.sync.applyRemote("cards", [{ ...dead, id: "c-remote", wordId: "w-remote", reps: 0, updatedAt: REMOTE_AT }]);
    await repo.sync.applyRemote("words", [remoteWord("w-remote", "harbor")]);

    const live = (await allCards(repo)).filter((c) => c.deletedAt === undefined);
    // A word has one card: the one with more reps, now on the surviving word.
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: dead.id, wordId: "w-remote", reps: dead.reps });
  });
});

describe("getReviewQueue with orphan cards", () => {
  it("skips cards whose word is deleted before the cap and before dueTotal / newToday", async () => {
    const repo = createIndexedDbRepository(freshName());
    const gone = await learn(repo, "alpha");
    await learn(repo, "beta");
    // The word of "alpha" is deleted remotely; its card stays behind.
    await repo.sync.applyRemote("words", [
      { ...remoteWord(gone.id, "alpha"), createdAt: gone.createdAt, deletedAt: REMOTE_AT },
    ]);

    // A cap of exactly one card: an orphan must not take that slot.
    const queue = await repo.cards.getReviewQueue(new Date(2026, 10, 17, 12), { maxMinutes: 1, secondsPerCard: 60 });
    expect(queue.cards.map((c) => c.word.lemma)).toEqual(["beta"]);
    expect(queue.dueTotal).toBe(1);
    expect(queue.newToday).toBe(1);
  });

  it("skips cards whose word does not exist at all", async () => {
    const repo = createIndexedDbRepository(freshName());
    await learn(repo, "beta");
    const card = (await allCards(repo))[0]!;
    await repo.sync.applyRemote("cards", [{ ...card, id: "c-orphan", wordId: "w-missing", updatedAt: REMOTE_AT }]);
    const queue = await repo.cards.getReviewQueue(LATER);
    expect(queue.cards).toHaveLength(1);
    expect(queue.dueTotal).toBe(1);
  });
});
