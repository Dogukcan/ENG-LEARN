// Mapping between local records (camelCase, nested objects) and Supabase rows (snake_case, jsonb).
//
// Why an explicit table instead of converting every key blindly: a blind converter would also
// rewrite the keys INSIDE jsonb columns (for example `rawReport.betterPhrases`), and the app
// reads those back as camelCase. Only the top-level column names are converted.

import { normalizeWord } from "../../data";
import type { SyncRow, SyncStore } from "../../data";

interface TableSpec {
  /** The Supabase table. */
  table: string;
  /** Fields that are always sent. A missing value is left out so the column default applies. */
  fields: readonly string[];
  /**
   * Fields that may be empty. When the local record has no value they are sent as null, so that
   * clearing a field (for example `undoWatched` removing `watchedAt`) reaches the other devices.
   */
  nullable: readonly string[];
  /** The field that feeds the `normalized` column (inbox and words only). */
  normalizedFrom?: "word" | "lemma";
}

/** Store name -> table and field lists. `id`, `updatedAt` and `deletedAt` are handled separately. */
export const TABLES: Record<SyncStore, TableSpec> = {
  books: { table: "eng_books", fields: ["title", "shortName", "unit", "page"], nullable: [] },
  settings: {
    table: "eng_settings",
    fields: ["dailyMinimumMinutes", "dailyTargetMinutes", "blockPlanMinutes", "newCardLimit"],
    nullable: ["activeBookId"],
  },
  inbox: {
    table: "eng_inbox",
    fields: ["word", "source", "createdAt"],
    nullable: ["sentence", "meaningTr", "alternatives", "previousStatus"],
    normalizedFrom: "word",
  },
  words: {
    table: "eng_words",
    fields: ["lemma", "status", "source", "createdAt"],
    nullable: ["meaningTr", "sentence", "alternatives"],
    normalizedFrom: "lemma",
  },
  cards: {
    table: "eng_cards",
    fields: [
      "wordId",
      "stability",
      "stabilityFast",
      "difficulty",
      "state",
      "scheduleStatus",
      "dueAt",
      "reps",
      "scheduledDays",
      "learningStep",
      "lapses",
      "leech",
      "createdAt",
    ],
    nullable: ["lastReviewAt"],
  },
  reviewLogs: {
    table: "eng_review_logs",
    fields: ["cardId", "grade", "reviewedAt", "revlog", "previousCard"],
    nullable: [],
  },
  activity: { table: "eng_activity", fields: ["block", "startedAt", "seconds", "source"], nullable: [] },
  videos: {
    table: "eng_videos",
    fields: ["youtubeId", "title", "channel", "level", "durationMinutes", "status", "createdAt"],
    nullable: ["watchedAt", "understanding", "activityId"],
  },
  speakingSessions: {
    table: "eng_speaking_sessions",
    fields: ["scenarioId", "startedAt", "rawReport", "createdAt"],
    nullable: [],
  },
  speakingErrors: {
    table: "eng_speaking_errors",
    fields: ["sessionId", "category", "original", "corrected", "createdAt"],
    nullable: ["note"],
  },
};

/**
 * The order in which stores are synced. Parents come before children (books before words,
 * words before cards, cards before review logs, sessions before their errors) so a device that
 * stops half way never holds a child whose parent is still missing on the server.
 */
export const SYNC_ORDER: readonly SyncStore[] = [
  "books",
  "settings",
  "inbox",
  "words",
  "cards",
  "reviewLogs",
  "activity",
  "videos",
  "speakingSessions",
  "speakingErrors",
];

export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Local record -> the object sent to Supabase.
 * `updated_at` is deliberately NOT sent: the database trigger stamps it with the server clock,
 * so a device with a wrong clock cannot make its old edit win. `user_id` is not sent either: the
 * column default is auth.uid().
 */
export function toRemoteRow(store: SyncStore, row: SyncRow): Record<string, unknown> {
  const spec = TABLES[store];
  const out: Record<string, unknown> = { id: row.id, deleted_at: row.deletedAt ?? null };
  for (const field of spec.fields) {
    const value = row[field];
    if (value !== undefined && value !== null) out[camelToSnake(field)] = value;
  }
  for (const field of spec.nullable) {
    out[camelToSnake(field)] = row[field] ?? null;
  }
  if (spec.normalizedFrom) {
    // The server needs `normalized` for its unique index; it is derived, never stored locally.
    out.normalized = normalizeWord(String(row[spec.normalizedFrom] ?? ""));
  }
  return out;
}

/** A row read from Supabase -> camelCase object for `applyRemote`. Unknown columns (user_id) are dropped. */
export function fromRemoteRow(store: SyncStore, raw: Record<string, unknown>): Record<string, unknown> {
  const spec = TABLES[store];
  const out: Record<string, unknown> = { id: raw.id, updatedAt: raw.updated_at, deletedAt: raw.deleted_at };
  for (const field of [...spec.fields, ...spec.nullable]) {
    const value = raw[camelToSnake(field)];
    if (value !== undefined) out[snakeToCamel(camelToSnake(field))] = value;
  }
  return out;
}
