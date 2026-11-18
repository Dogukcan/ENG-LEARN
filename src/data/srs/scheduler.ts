// Scheduler wrapper around ts-fsrs 6.
//
// Why a wrapper? ts-fsrs works with `Date` objects and its own card shape, while we store ISO
// strings and our own `Card`. All conversion and all FSRS settings live in this one file, so
// the rest of the app never imports ts-fsrs and a future parameter change touches one place.

import { DefaultScheduler, Rating, State } from "ts-fsrs";
import type { Card, CardScheduleStatus, CardState, FsrsRevlog, ReviewGrade } from "../types";

/** A word forgotten this many times is a "leech": it eats review time and needs a new approach. */
export const LEECH_THRESHOLD = 5;

export interface SchedulerOptions {
  /**
   * Fuzz adds a small random shift to each interval so cards learned on the same day do not
   * all fall due on the same day forever. It makes results random, so tests turn it off.
   */
  enableFuzz?: boolean;
}

export type FsrsScheduler = Awaited<ReturnType<typeof createScheduler>>;

function createScheduler(enableFuzz: boolean) {
  return DefaultScheduler({
    // FSRS-7 is the newest model. It also tracks a fast short-term memory trace.
    version: "FSRS-7",
    // 0.9 = aim to recall a word 90% of the time when it is shown. Higher means more reviews.
    desiredRetention: 0.9,
    // Short-term on: a new or forgotten card first goes through minute-sized steps.
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    enableFuzz,
    // 100 years: effectively no cap.
    maximumInterval: 36_500,
  });
}

// Creating a scheduler is async (it loads the model), so it is created once per fuzz setting
// and the promise is cached. "Lazily" = nothing happens until the first review.
const schedulers = new Map<boolean, Promise<FsrsScheduler>>();

export function getScheduler(options: SchedulerOptions = {}): Promise<FsrsScheduler> {
  const enableFuzz = options.enableFuzz ?? false;
  let scheduler = schedulers.get(enableFuzz);
  if (!scheduler) {
    scheduler = createScheduler(enableFuzz);
    schedulers.set(enableFuzz, scheduler);
  }
  return scheduler;
}

// ---------- Conversion between our stored Card and ts-fsrs ----------

function toFsrsCard(card: Card) {
  return {
    stability: card.stability,
    stabilityFast: card.stabilityFast,
    difficulty: card.difficulty,
    state: card.state as State,
    scheduleStatus: card.scheduleStatus,
    dueAt: new Date(card.dueAt),
    lastReviewAt: card.lastReviewAt === null ? null : new Date(card.lastReviewAt),
    cardId: card.id,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduledDays,
    learningStep: card.learningStep,
  };
}

interface FsrsCardOutput {
  stability: number;
  stabilityFast: number;
  difficulty: number;
  state: number;
  scheduleStatus: CardScheduleStatus;
  dueAt: Date;
  lastReviewAt: Date | null;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep: number;
}

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

// Each operation has a sync "...With(scheduler, ...)" form and an async convenience form.
// Why both? IndexedDB closes a transaction if the code awaits something that is not an IndexedDB
// request. The repository therefore awaits the scheduler BEFORE opening a transaction and then
// uses the sync forms inside it.

/** A brand-new card for a word, due immediately (a new word is meant to be seen right away). */
export function createNewCardWith(scheduler: FsrsScheduler, wordId: string, now: Date): Card {
  const fresh = scheduler.newCard({ now });
  return {
    id: String(fresh.cardId),
    wordId,
    stability: fresh.stability,
    stabilityFast: fresh.stabilityFast,
    difficulty: fresh.difficulty,
    state: fresh.state as CardState,
    scheduleStatus: fresh.scheduleStatus,
    dueAt: fresh.dueAt.toISOString(),
    lastReviewAt: iso(fresh.lastReviewAt),
    reps: fresh.reps,
    lapses: 0,
    scheduledDays: fresh.scheduledDays,
    learningStep: fresh.learningStep,
    leech: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function createNewCard(
  wordId: string,
  now: Date,
  options: SchedulerOptions = {},
): Promise<Card> {
  return createNewCardWith(await getScheduler(options), wordId, now);
}

export interface GradeResult {
  card: Card;
  revlog: FsrsRevlog;
}

/**
 * Apply one answer to a card and return the new card plus the ts-fsrs log entry.
 * "Unuttum" (again) = Rating.Again, "Hatırladım" (good) = Rating.Good. The input card is not
 * changed; the result is a new object.
 */
export function gradeCardWith(
  scheduler: FsrsScheduler,
  card: Card,
  grade: ReviewGrade,
  now: Date,
): GradeResult {
  const { card: next, revlog } = scheduler.review({
    card: toFsrsCard(card),
    grade: grade === "again" ? Rating.Again : Rating.Good,
    now,
  });
  const out = next as FsrsCardOutput;

  // A lapse = forgetting a word that was already in long-term memory. Like Anki, we count it
  // only when "again" is given to a card in the Review state. "Again" during the first learning
  // steps or during relearning is not a new lapse: the word was already counted when it fell out
  // of Review, and counting every failed retry would turn normal struggling into a "leech".
  // We count it ourselves (not from ts-fsrs) so the rule is explicit.
  const lapses = card.lapses + (grade === "again" && card.state === State.Review ? 1 : 0);

  return {
    card: {
      id: card.id,
      wordId: card.wordId,
      stability: out.stability,
      stabilityFast: out.stabilityFast,
      difficulty: out.difficulty,
      state: out.state as CardState,
      scheduleStatus: out.scheduleStatus,
      dueAt: out.dueAt.toISOString(),
      lastReviewAt: iso(out.lastReviewAt),
      reps: out.reps,
      lapses,
      scheduledDays: out.scheduledDays,
      learningStep: out.learningStep,
      leech: card.leech || lapses >= LEECH_THRESHOLD,
      createdAt: card.createdAt,
      updatedAt: now.toISOString(),
    },
    revlog: {
      rating: revlog.rating,
      state: revlog.state as CardState,
      scheduleStatus: revlog.scheduleStatus,
      stability: revlog.stability,
      stabilityFast: revlog.stabilityFast,
      difficulty: revlog.difficulty,
      dueAt: revlog.dueAt.toISOString(),
      lastReviewAt: iso(revlog.lastReviewAt),
      reviewTime: revlog.reviewTime.toISOString(),
      scheduledDays: revlog.scheduledDays,
      learningStep: revlog.learningStep,
    },
  };
}

/**
 * Chance (0 to 1) that the user can recall the word at `now`, from the FSRS forgetting curve:
 * the curve starts at 1 right after a review and falls with the days passed, more slowly for
 * cards with a high stability. A card that was never reviewed has no memory yet, so it is 0.
 *
 * Why it exists: the review queue shows the cards most likely to be forgotten first, which
 * spends limited review time where it helps memory most.
 */
export function recallProbabilityWith(scheduler: FsrsScheduler, card: Card, now: Date): number {
  if (card.lastReviewAt === null || card.state === State.New) return 0;
  const elapsedDays = Math.max(
    0,
    scheduler.chrono.difference(new Date(card.lastReviewAt), now),
  );
  return scheduler.model.forgettingCurve(
    { stability: card.stability, stabilityFast: card.stabilityFast, difficulty: card.difficulty },
    elapsedDays,
  );
}

export async function gradeCard(
  card: Card,
  grade: ReviewGrade,
  now: Date,
  options: SchedulerOptions = {},
): Promise<GradeResult> {
  return gradeCardWith(await getScheduler(options), card, grade, now);
}

export async function recallProbability(
  card: Card,
  now: Date,
  options: SchedulerOptions = {},
): Promise<number> {
  return recallProbabilityWith(await getScheduler(options), card, now);
}
