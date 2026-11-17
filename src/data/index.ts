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
  SettingsPatch,
  TriageResult,
} from "./repository";
export { DEFAULT_SETTINGS, SKILL_BLOCKS, applySettingsPatch, normalizeWord } from "./repository";
export { localDayRange, toLocalDay, type LocalDay } from "./localDay";
export { createIndexedDbRepository } from "./indexeddb";

/** The single app-wide repository. The database opens lazily on first use. */
export const repository: Repository = createIndexedDbRepository();
