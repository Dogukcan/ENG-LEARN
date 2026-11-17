// Public entry point of the data layer. Screens import from "src/data" only, never from
// indexeddb.ts directly. That keeps the storage choice in ONE line below: in Faz 4 we change
// `createIndexedDbRepository()` to a Supabase implementation and no screen notices.

import { createIndexedDbRepository } from "./indexeddb";
import type { Repository } from "./repository";

export type * from "./types";
export type {
  AddInboxResult,
  BookInput,
  BookPosition,
  NewActivityLog,
  NewInboxItem,
  Repository,
  ReviewQueue,
  ReviewQueueOptions,
  ReviewResult,
  SettingsPatch,
  TriageResult,
  UndoResult,
} from "./repository";
export { DEFAULT_SETTINGS, SKILL_BLOCKS, applySettingsPatch, normalizeWord } from "./repository";
export { localDayRange, toLocalDay, type LocalDay } from "./localDay";
export { createIndexedDbRepository } from "./indexeddb";
export { buildPrompt, checkAnswer, type Prompt, type PromptWord } from "./srs/prompt";

/**
 * The single app-wide repository. The database opens lazily on first use. Fuzz is on in the app
 * (intervals get a small random shift so cards do not pile up on one day) and off in tests.
 */
export const repository: Repository = createIndexedDbRepository("eng-learn", { enableFuzz: true });
