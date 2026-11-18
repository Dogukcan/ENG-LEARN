// Shape checks for rows that arrive from the server (sync).
//
// Why check at all? The rows come over the network. A row with a missing field (for example an
// inbox item without `source`) would be stored and later crash a screen that trusts the types.
// Checking once, at the door, keeps the rest of the app simple. A row that fails is counted as
// "invalid" by `applyRemote` and ignored; it never reaches the database.
//
// The server (Postgres) returns SQL NULL for an empty optional column, while our types use
// "field missing". So every optional field accepts null and is then removed (see `clean`).

import { z } from "zod";
import type { SyncStore } from "./repository";

// Postgres sends times like "2026-11-17T07:30:00.123456+00:00"; the app stores
// "2026-11-17T07:30:00.123Z". The two do not compare correctly as text, and the IndexedDB indexes
// sort as text, so every date is rewritten to the app's own form on the way in.
const isoString = z
  .string()
  .refine((text) => Number.isFinite(Date.parse(text)), "not an ISO date")
  .transform((text) => new Date(text).toISOString());
const optionalText = z.string().nullish();
const id = z.string().min(1);

const sync = { id, updatedAt: isoString, deletedAt: isoString.nullish() };

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("kitap"), bookId: z.string(), page: z.number() }),
  z.object({ kind: z.literal("video"), label: z.string().optional() }),
  z.object({ kind: z.literal("konusma") }),
  z.object({ kind: z.literal("diger") }),
]);

const skillBlock = z.enum(["okuma", "kelime", "dinleme", "konusma"]);
const cardState = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const scheduleStatus = z.enum(["new", "learning", "review"]);

const cardShape = z.object({
  id,
  wordId: z.string(),
  stability: z.number(),
  stabilityFast: z.number(),
  difficulty: z.number(),
  state: cardState,
  scheduleStatus,
  dueAt: isoString,
  lastReviewAt: isoString.nullable(),
  reps: z.number(),
  scheduledDays: z.number(),
  learningStep: z.number(),
  lapses: z.number(),
  leech: z.boolean(),
  createdAt: isoString,
  updatedAt: isoString,
  deletedAt: isoString.nullish(),
});

const settingsFields = {
  dailyMinimumMinutes: z.number().optional(),
  dailyTargetMinutes: z.number().optional(),
  blockPlanMinutes: z
    .object({
      okuma: z.number().optional(),
      kelime: z.number().optional(),
      dinleme: z.number().optional(),
      konusma: z.number().optional(),
    })
    .optional(),
  newCardLimit: z.number().optional(),
  activeBookId: z.string().nullish(),
};

const report = z.object({
  errors: z.array(
    z.object({ original: z.string(), corrected: z.string(), category: z.string(), note: z.string().optional() }),
  ),
  betterPhrases: z.array(z.object({ original: z.string(), better: z.string() })),
  newWords: z.array(
    z.object({ word: z.string(), sentence: z.string().optional(), meaningTr: z.string().optional() }),
  ),
  summary: z.string().optional(),
});

export const rowSchemas = {
  books: z.object({
    ...sync,
    title: z.string(),
    shortName: z.string(),
    unit: z.number().int().min(1),
    page: z.number().int().min(1),
  }),
  inbox: z.object({
    ...sync,
    word: z.string(),
    sentence: optionalText,
    meaningTr: optionalText,
    alternatives: z.array(z.string()).nullish(),
    source,
    createdAt: isoString,
    previousStatus: z.enum(["known", "ignored"]).nullish(),
  }),
  words: z.object({
    ...sync,
    lemma: z.string(),
    status: z.enum(["learning", "known", "ignored"]),
    meaningTr: optionalText,
    sentence: optionalText,
    alternatives: z.array(z.string()).nullish(),
    source,
    createdAt: isoString,
  }),
  cards: cardShape,
  reviewLogs: z.object({
    ...sync,
    cardId: z.string(),
    grade: z.enum(["again", "good"]),
    reviewedAt: isoString,
    // These two are only ever read back whole (see 0001_init.sql), so they are checked loosely.
    revlog: z.record(z.string(), z.unknown()),
    previousCard: z.record(z.string(), z.unknown()),
  }),
  activity: z.object({
    ...sync,
    block: skillBlock,
    startedAt: isoString,
    seconds: z.number().int().min(0),
    source: z.enum(["timer", "manual"]),
  }),
  settings: z.object({ ...sync, ...settingsFields }),
  videos: z.object({
    ...sync,
    youtubeId: z.string().min(1),
    title: z.string(),
    channel: z.string(),
    level: z.enum(["kolay", "orta", "zor"]),
    durationMinutes: z.number().int().min(1),
    status: z.enum(["todo", "watched"]),
    watchedAt: isoString.nullish(),
    understanding: z.enum(["az", "yarisi", "cogu"]).nullish(),
    activityId: optionalText,
    createdAt: isoString,
  }),
  speakingSessions: z.object({
    ...sync,
    scenarioId: z.string(),
    startedAt: isoString,
    rawReport: report,
    createdAt: isoString,
  }),
  speakingErrors: z.object({
    ...sync,
    sessionId: z.string(),
    category: z.string(),
    original: z.string(),
    corrected: z.string(),
    note: optionalText,
    createdAt: isoString,
  }),
} satisfies Record<SyncStore, z.ZodType>;

/** Remove keys whose value is null or undefined, so "empty" always means "field missing". */
function clean(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) result[key] = entry;
  }
  return result;
}

/**
 * Check one remote row for a store. Returns the cleaned row (only the known fields) or null
 * when the row does not fit. The result is cast to the store's record type by the caller.
 */
export function parseRemoteRow(store: SyncStore, row: unknown): Record<string, unknown> | null {
  const parsed = rowSchemas[store].safeParse(row);
  if (!parsed.success) return null;
  return clean(parsed.data as Record<string, unknown>);
}
