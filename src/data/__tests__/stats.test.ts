import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import { addLocalDays, listLocalDays } from "../localDay";
import type { Repository } from "../repository";
import type { WordStatus } from "../types";

const freshName = () => `eng-learn-stats-test-${crypto.randomUUID()}`;
const TODAY = "2026-11-17";
/** Local time on a given day of November 2026 (tests run in Europe/Istanbul, see vitest config). */
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute);

async function sortWord(repo: Repository, word: string, status: WordStatus, now = at(17)) {
  const added = await repo.inbox.add({ word, source: { kind: "diger" } });
  if (!added.ok) throw new Error(`add failed: ${added.reason}`);
  const result = await repo.words.triage(added.item.id, status, now);
  if (!result.ok) throw new Error(`triage failed: ${result.reason}`);
  return result.word;
}

describe("local day helpers", () => {
  it("addLocalDays and listLocalDays handle month ends and bad input", () => {
    expect(addLocalDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addLocalDays(TODAY, 0)).toBe(TODAY);
    expect(listLocalDays("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(listLocalDays("2026-11-17", "2026-11-16")).toEqual([]);
    expect(() => addLocalDays("2026-13-01", 1)).toThrow(RangeError);
  });
});

describe("stats.minutesPerBlockPerDay", () => {
  it("returns every day of the range, zero filled, with minutes per block", async () => {
    const repo = createIndexedDbRepository(freshName());
    await repo.activity.add({ block: "okuma", startedAt: at(15, 10).toISOString(), seconds: 30 * 60, source: "timer" });
    await repo.activity.add({ block: "okuma", startedAt: at(15, 20).toISOString(), seconds: 90, source: "timer" });
    await repo.activity.add({ block: "kelime", startedAt: at(17, 0, 30).toISOString(), seconds: 600, source: "manual" }); // 00:30 local = 21:30Z the day before
    await repo.activity.add({ block: "dinleme", startedAt: at(20).toISOString(), seconds: 600, source: "manual" }); // outside
    const days = await repo.stats.minutesPerBlockPerDay({ from: "2026-11-15", to: "2026-11-17" });
    expect(days.map((d) => d.day)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(days[0]?.minutes).toEqual({ okuma: 31.5, kelime: 0, dinleme: 0, konusma: 0 });
    expect(days[1]?.minutes).toEqual({ okuma: 0, kelime: 0, dinleme: 0, konusma: 0 });
    expect(days[2]?.minutes).toEqual({ okuma: 0, kelime: 10, dinleme: 0, konusma: 0 });
    expect(await repo.stats.minutesPerBlockPerDay({ from: "2026-11-17", to: "2026-11-16" })).toEqual([]);
  });
});

describe("stats.consistency", () => {
  it("counts days that reach the daily minimum in the last 7 and 30 days", async () => {
    const repo = createIndexedDbRepository(freshName()); // minimum is 20 by default
    const add = (day: number, minutes: number, block: "okuma" | "kelime" = "okuma") =>
      repo.activity.add({ block, startedAt: at(day).toISOString(), seconds: minutes * 60, source: "manual" });
    await add(17, 20); // exactly the minimum: counts
    await add(16, 19); // one minute short
    await add(15, 10);
    await add(15, 10, "kelime"); // two blocks add up to 20: counts
    await add(5, 25); // inside 30 days, outside 7 days
    await add(18, 60); // the future relative to TODAY: ignored
    expect(await repo.stats.consistency(TODAY)).toEqual({ last7: 2, last30: 3 });

    await repo.settings.update({ dailyMinimumMinutes: 10 });
    expect(await repo.stats.consistency(TODAY)).toEqual({ last7: 3, last30: 4 });
    // The window is exactly 30 local days: 18 Oct is outside, 19 Oct is inside.
    await repo.activity.add({ block: "okuma", startedAt: new Date(2026, 9, 18, 12).toISOString(), seconds: 3600, source: "manual" });
    await repo.activity.add({ block: "okuma", startedAt: new Date(2026, 9, 19, 12).toISOString(), seconds: 3600, source: "manual" });
    expect(await repo.stats.consistency(TODAY)).toEqual({ last7: 3, last30: 5 });
  });
});

describe("stats.totalListeningMinutes", () => {
  it("sums all dinleme seconds, rounds down once, and ignores other blocks", async () => {
    const repo = createIndexedDbRepository(freshName());
    expect(await repo.stats.totalListeningMinutes()).toBe(0);
    await repo.activity.add({ block: "dinleme", startedAt: at(1).toISOString(), seconds: 90, source: "manual" });
    await repo.activity.add({ block: "dinleme", startedAt: at(2).toISOString(), seconds: 90, source: "timer" });
    await repo.activity.add({ block: "okuma", startedAt: at(2).toISOString(), seconds: 6000, source: "timer" });
    expect(await repo.stats.totalListeningMinutes()).toBe(3); // 180 s, not 1 + 1
  });
});

describe("stats.wordCounts and knownWordsPerNgslBand", () => {
  it("counts words per status", async () => {
    const repo = createIndexedDbRepository(freshName());
    await sortWord(repo, "walk", "learning");
    await sortWord(repo, "borrow", "known");
    await sortWord(repo, "agency", "known");
    await sortWord(repo, "zebra", "ignored");
    expect(await repo.stats.wordCounts()).toEqual({ learning: 1, known: 2, ignored: 1 });
  });

  it("puts known words into NGSL bands by rank; learning and unknown words do not count", async () => {
    const repo = createIndexedDbRepository(freshName());
    await sortWord(repo, "walk", "known"); // rank 339
    await sortWord(repo, "Knowledge", "known"); // rank 619, lookup ignores case
    await sortWord(repo, "borrow", "known"); // rank 1880
    await sortWord(repo, "harbor", "known"); // rank 2704
    await sortWord(repo, "zebra", "known"); // not on the list
    await sortWord(repo, "agency", "learning"); // not known: not counted
    expect(await repo.stats.knownWordsPerNgslBand()).toEqual({
      "1-1000": 2,
      "1001-2000": 1,
      "2001-2809": 1,
      "listede yok": 1,
    });
  });

  it("returns zeros for an empty database", async () => {
    const repo = createIndexedDbRepository(freshName());
    expect(await repo.stats.wordCounts()).toEqual({ learning: 0, known: 0, ignored: 0 });
    expect(await repo.stats.knownWordsPerNgslBand()).toEqual({ "1-1000": 0, "1001-2000": 0, "2001-2809": 0, "listede yok": 0 });
  });
});

describe("stats.reviewSuccessRate and leechCount", () => {
  it("is null without reviews, then the share of good answers in the last 7 days", async () => {
    const repo = createIndexedDbRepository(freshName());
    expect(await repo.stats.reviewSuccessRate(TODAY)).toEqual({ good: 0, total: 0, rate: null });
    const word = await sortWord(repo, "walk", "learning", at(1));
    const queue = await repo.cards.getReviewQueue(at(17));
    const card = queue.cards.find((entry) => entry.word.id === word.id)?.card;
    if (!card) throw new Error("no card");
    // Oldest first: FSRS refuses a review that happens before the previous one.
    await repo.cards.reviewCard(card.id, "good", at(9, 23)); // day before the window: ignored
    await repo.cards.reviewCard(card.id, "good", at(11, 9)); // first day of the window (17 - 6)
    await repo.cards.reviewCard(card.id, "again", at(12, 9));
    await repo.cards.reviewCard(card.id, "good", at(17, 23));
    const rate = await repo.stats.reviewSuccessRate(TODAY);
    expect(rate.total).toBe(3);
    expect(rate.good).toBe(2);
    expect(rate.rate).toBeCloseTo(2 / 3);

    // An undone review no longer counts.
    await repo.cards.undoLastReview(); // the newest by time is the one on the 17th
    expect(await repo.stats.reviewSuccessRate(TODAY)).toMatchObject({ good: 1, total: 2 });
  });

  it("counts leech cards", async () => {
    const repo = createIndexedDbRepository(freshName());
    expect(await repo.stats.leechCount()).toBe(0);
    await sortWord(repo, "walk", "learning");
    const [row] = await repo.sync.listChangedSince("cards", "1970-01-01T00:00:00.000Z");
    if (!row) throw new Error("no card");
    await repo.sync.applyRemote("cards", [{ ...row, leech: true, updatedAt: "2099-01-01T00:00:00.000Z" }]);
    expect(await repo.stats.leechCount()).toBe(1);
  });
});

describe("stats.speakingErrorsWeekOverWeek", () => {
  it("compares the last 7 days with the 7 days before, per category", async () => {
    const repo = createIndexedDbRepository(freshName());
    const save = (day: number, categories: string[]) =>
      repo.speaking.saveReport(
        { scenarioId: "s", startedAt: at(day).toISOString() },
        {
          errors: categories.map((category) => ({ original: "a", corrected: "b", category })),
          betterPhrases: [],
          newWords: [],
        },
      );
    await save(17, ["article", "article", "preposition"]); // this week
    await save(11, ["article"]); // this week (first day of the window)
    await save(10, ["article", "word-order"]); // last week (last day)
    await save(4, ["preposition"]); // last week (first day)
    await save(3, ["article"]); // too old
    expect(await repo.stats.speakingErrorsWeekOverWeek(TODAY)).toEqual({
      article: { thisWeek: 3, lastWeek: 1 },
      preposition: { thisWeek: 1, lastWeek: 1 },
      "word-order": { thisWeek: 0, lastWeek: 1 },
    });
    expect(await createIndexedDbRepository(freshName()).stats.speakingErrorsWeekOverWeek(TODAY)).toEqual({});
  });
});
