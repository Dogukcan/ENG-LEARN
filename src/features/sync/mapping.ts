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

/**
 * The column behind each partial unique index on the server (see the migrations). A push that
 * hits one of them (Postgres error 23505) means another device already holds the same word,
 * video or card under a different id; the engine looks that twin up by this column.
 */
export const UNIQUE_COLUMNS: Partial<Record<SyncStore, string>> = {
  inbox: "normalized",
  words: "normalized",
  cards: "word_id",
  videos: "youtube_id",
};

/**
 * The local settings record always has the id "app" (one record per device). On the server the
 * id is the primary key of the whole table, so the same "app" from a second account would collide
 * with the first account's row. The remote id is therefore the account's own user id.
 */
export const LOCAL_SETTINGS_ID = "app";

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
 * `client_updated_at` is the local time of the edit. It is NOT used as the row's time; the server
 * only compares it with its own `updated_at` to reject an edit that is older than what it already
 * holds (see migration 0003), so a restarted or long-offline device cannot overwrite newer data.
 */
export function toRemoteRow(store: SyncStore, row: SyncRow, userId?: string): Record<string, unknown> {
  const spec = TABLES[store];
  const id = store === "settings" && userId ? userId : row.id;
  const out: Record<string, unknown> = { id, deleted_at: row.deletedAt ?? null, client_updated_at: row.updatedAt };
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
  const id = store === "settings" ? LOCAL_SETTINGS_ID : raw.id;
  const out: Record<string, unknown> = { id, updatedAt: raw.updated_at, deletedAt: raw.deleted_at };
  for (const field of [...spec.fields, ...spec.nullable]) {
    const value = raw[camelToSnake(field)];
    if (value !== undefined) out[snakeToCamel(camelToSnake(field))] = value;
  }
  return out;
}
