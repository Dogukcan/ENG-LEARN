// Public entry point of the data layer. Screens import from "src/data" only, never from
// indexeddb.ts directly. That keeps the storage choice in ONE line below: in Faz 4 we change
// `createIndexedDbRepository()` to a Supabase implementation and no screen notices.

import { createIndexedDbRepository } from "./indexeddb";
import type { Repository } from "./repository";

export type * from "./types";
export type {
  AddInboxResult,
  AddVideoResult,
  ApplyRemoteResult,
  BookInput,
  BookPosition,
  CategoryWeeks,
  Consistency,
  DayMinutes,
  DayRange,
  MarkWatchedResult,
  NewActivityLog,
  NewInboxItem,
  NewSpeakingSession,
  NewVideo,
  NgslBand,
  Repository,
  ReviewQueue,
  ReviewQueueOptions,
  ReviewResult,
  ReviewSuccess,
  SaveReportResult,
  SettingsPatch,
  SyncRow,
  SyncStore,
  TriageResult,
  UndoResult,
  UndoWatchedResult,
} from "./repository";
export {
  DEFAULT_SETTINGS,
  NGSL_BANDS,
  SKILL_BLOCKS,
  SYNC_STORES,
  applySettingsPatch,
  normalizeWord,
} from "./repository";
export { addLocalDays, listLocalDays, localDayRange, toLocalDay, type LocalDay } from "./localDay";
export { createIndexedDbRepository } from "./indexeddb";
export { buildPrompt, checkAnswer, type Prompt, type PromptWord } from "./srs/prompt";

/**
 * The single app-wide repository. The database opens lazily on first use. Fuzz is on in the app
 * (intervals get a small random shift so cards do not pile up on one day) and off in tests.
 */
export const repository: Repository = createIndexedDbRepository("eng-learn", { enableFuzz: true });
