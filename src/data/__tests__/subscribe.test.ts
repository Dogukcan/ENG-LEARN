import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import { checkAnswer } from "../srs/prompt";

function freshRepo() {
  return createIndexedDbRepository(`eng-learn-subscribe-test-${crypto.randomUUID()}`);
}

const NOW = new Date(2026, 10, 17, 10, 0);

describe("repository.subscribe", () => {
  it("calls the listener after add, triage and review", async () => {
    const repo = freshRepo();
    const listener = vi.fn();
    repo.subscribe(listener);

    const added = await repo.inbox.add({ word: "anchor", source: { kind: "diger" } });
    if (!added.ok) throw new Error("add failed");
    expect(listener).toHaveBeenCalledTimes(1);

    const triaged = await repo.words.triage(added.item.id, "learning", NOW);
    if (!triaged.ok) throw new Error("triage failed");
    expect(listener).toHaveBeenCalledTimes(2);

    const queue = await repo.cards.getReviewQueue(NOW);
    expect(listener).toHaveBeenCalledTimes(2); // reading never notifies
    const first = queue.cards[0];
    if (!first) throw new Error("queue is empty");
    await repo.cards.reviewCard(first.card.id, "good", NOW);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not notify when nothing was written", async () => {
    const repo = freshRepo();
    const listener = vi.fn();
    repo.subscribe(listener);

    await repo.inbox.add({ word: "   ", source: { kind: "diger" } }); // empty -> refused
    await repo.words.triage("no-such-item", "known", NOW); // not-found
    await repo.inbox.remove("no-such-item"); // nothing removed
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops calling a listener after unsubscribe", async () => {
    const repo = freshRepo();
    const listener = vi.fn();
    const unsubscribe = repo.subscribe(listener);

    await repo.inbox.add({ word: "one", source: { kind: "diger" } });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await repo.inbox.add({ word: "two", source: { kind: "diger" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lets other listeners run when one throws", async () => {
    const repo = freshRepo();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const second = vi.fn();
    repo.subscribe(() => {
      throw new Error("broken listener");
    });
    repo.subscribe(second);

    await repo.inbox.add({ word: "one", source: { kind: "diger" } });
    expect(second).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});

describe("alternatives", () => {
  it("are cleaned on add, kept through triage and accepted by checkAnswer", async () => {
    const repo = freshRepo();
    const added = await repo.inbox.add({
      word: "harbor",
      alternatives: [" Harbour ", "", "  ", "HARBOUR", "haven"],
      source: { kind: "diger" },
    });
    if (!added.ok) throw new Error("add failed");
    expect(added.item.alternatives).toEqual(["harbour", "haven"]);
    expect((await repo.inbox.list())[0]?.alternatives).toEqual(["harbour", "haven"]);

    const triaged = await repo.words.triage(added.item.id, "learning", NOW);
    if (!triaged.ok) throw new Error("triage failed");
    expect(triaged.word.alternatives).toEqual(["harbour", "haven"]);
    expect(checkAnswer("Harbour", triaged.word)).toBe(true);
    expect(checkAnswer("harbor", triaged.word)).toBe(true);
    expect(checkAnswer("harb", triaged.word)).toBe(false);
  });

  it("are left out when the list has only blanks", async () => {
    const repo = freshRepo();
    const added = await repo.inbox.add({
      word: "plain",
      alternatives: [" ", ""],
      source: { kind: "diger" },
    });
    if (!added.ok) throw new Error("add failed");
    expect(added.item).not.toHaveProperty("alternatives");
  });
});
