// The sync engine: keeps the local IndexedDB data and the Supabase tables in step.
//
// The app stays offline-first. IndexedDB is the working copy; this engine only copies changes
// in both directions when it can. Every function that talks to the network is wrapped so a
// failure becomes a visible status ("offline" / "error"), never a crash and never lost data.
//
// One round, per store, in a fixed order (see SYNC_ORDER):
//   1. PUSH: local rows changed since the last push -> upsert into the eng_* table.
//   2. PULL: server rows changed since the last pull (minus a 2 s overlap) -> repo.sync.applyRemote.
//
// Conflicts are "last write wins" and are decided by `updated_at`, which the server stamps. A push
// also carries the local edit time (`client_updated_at`); the server refuses an edit that is
// older than the row it already holds (migration 0003), so an old copy can never win.

import type { Repository, SyncRow, SyncStore } from "../../data";
import { z } from "zod";
import { parseRemoteRow } from "../../data/syncSchemas";
import { SYNC_ORDER, TABLES, UNIQUE_COLUMNS, fromRemoteRow, toRemoteRow } from "./mapping";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "disabled";

export interface SyncState {
  status: SyncStatus;
  /** Local changes that are not on the server yet. */
  pendingCount: number;
  /** ISO time of the last round that finished without an error, or null. */
  lastSyncedAt: string | null;
  /** The reason of the last failed round, or null. */
  lastError: string | null;
  /**
   * True while a different account signed in on a device that still holds the previous account's
   * data. Sync stays off until `confirmUserSwitch` is called, so nothing is uploaded unasked.
   */
  foreignData?: boolean;
}

// ---------- The small part of the Supabase client the engine uses ----------
// Declared here (instead of importing SupabaseClient) so tests can pass a plain fake object.
// The real client matches this shape; the cast happens in one place, in runtime.ts.

interface QueryError {
  message: string;
  /** Postgres error code, for example "23505" (unique violation). */
  code?: string;
}
interface SelectQuery extends PromiseLike<{ data: Array<Record<string, unknown>> | null; error: QueryError | null }> {
  gt(column: string, value: string): SelectQuery;
  eq(column: string, value: string): SelectQuery;
  or(filters: string): SelectQuery;
  order(column: string, options: { ascending: boolean }): SelectQuery;
  range(from: number, to: number): SelectQuery;
}
export interface RealtimeChannelLike {
  on(
    type: "postgres_changes",
    filter: { event: "*"; schema: "public"; table: string },
    callback: () => void,
  ): RealtimeChannelLike;
  subscribe(): unknown;
}
export interface SyncClient {
  rpc?(name: "eng_merge_card" | "eng_push_card_bundle", args: { p_card: Record<string, unknown> | null; p_logs?: Record<string, unknown>[] }): PromiseLike<{ data: unknown; error: QueryError | null }>;
  from(table: string): {
    upsert(rows: Array<Record<string, unknown>>, options: { onConflict: string }): PromiseLike<{ error: QueryError | null }>;
    select(columns: string): SelectQuery;
  };
  channel?(name: string): RealtimeChannelLike;
  removeChannel?(channel: RealtimeChannelLike): unknown;
}

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SyncEngineOptions {
  repo: Pick<Repository, "sync" | "subscribe">;
  /** null when Supabase is not configured: the engine is then "disabled" for good. */
  client: SyncClient | null;
  now: () => Date;
  /** Where the cursors live. Default: localStorage (guarded). Pass null for memory only. */
  storage?: SyncStorage | null;
  /** Wait after a local change before syncing, so a burst of writes becomes one round. Default 2000. */
  debounceMs?: number;
  /** Default: navigator.onLine. */
  isOnline?: () => boolean;
}

export interface SyncEngine {
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
  /** Sets the signed-in user (or null). Signing in starts a round; signing out stops everything. */
  setUser(userId: string | null): void;
  /**
   * Answer to `state.foreignData`: another account's data is on this device.
   * "clear" deletes the local data first and then downloads this account's data;
   * "keep" uploads the local data into this account. Nothing is uploaded before this is called.
   */
  confirmUserSwitch(choice: "clear" | "keep"): Promise<void>;
  /** Runs one full round now. Overlapping calls share the running round. Never throws. */
  syncNow(): Promise<void>;
  /** Attaches the automatic triggers (local changes, online, tab visible). Returns a stop function. */
  start(): () => void;
}

const EPOCH = "1970-01-01T00:00:00.000Z";
const PAGE_SIZE = 1000;
const PUSH_CHUNK = 200;
/** Pulls start a little before the last cursor so a row committed late (slow transaction) is not missed. */
export const PULL_OVERLAP_MS = 2000;
const KEY = "eng-learn.sync.";
/** Postgres errors that belong to one row (unique key, missing parent), not to the whole request. */
const ROW_ERROR_CODES = new Set(["23505", "23503"]);
const NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

class SyncFailure extends Error {
  // Declared as a field (not a constructor parameter property): the project forbids that syntax.
  readonly offline: boolean;
  constructor(message: string, offline: boolean) {
    super(message);
    this.offline = offline;
  }
}

/** localStorage can throw (private mode, blocked site data), so every access is guarded. */
function defaultStorage(): SyncStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function failureFrom(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  const message = error instanceof Error ? error.message : String((error as QueryError | undefined)?.message ?? error);
  return new SyncFailure(message, NETWORK_ERROR.test(message));
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { repo, client, now } = options;
  const debounceMs = options.debounceMs ?? 2000;
  const isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const memory = new Map<string, string>();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;

  const read = (key: string): string | null => {
    try {
      return storage?.getItem(KEY + key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  };
  const write = (key: string, value: string): void => {
    memory.set(key, value);
    try {
      storage?.setItem(KEY + key, value);
    } catch {
      // Storage full or blocked: the in-memory copy still works for this session.
    }
  };

  let userId: string | null = null;
  let started = false;
  let state: SyncState = {
    status: "disabled",
    pendingCount: 0,
    lastSyncedAt: read("lastSyncedAt"),
    lastError: null,
  };
  const listeners = new Set<() => void>();

  const setState = (patch: Partial<SyncState>): void => {
    const next = { ...state, ...patch };
    if (next.status === state.status && next.pendingCount === state.pendingCount && next.lastSyncedAt === state.lastSyncedAt && next.lastError === state.lastError && next.foreignData === state.foreignData) {
      return;
    }
    // A new object every time: useSyncExternalStore compares snapshots by reference.
    state = next;
    for (const listener of listeners) listener();
  };

  /**
   * Rows whose current local version is already on the server (id -> updatedAt), per store.
   * Two kinds of rows are in it: rows that came FROM the server (applyRemote wrote them, so they
   * changed locally too) and rows this device just pushed. Sending either again would make the
   * server bump `updated_at`, which we would pull again, and so on forever.
   * It is saved in storage because a map that lives only in memory is empty after a restart; the
   * app then pushed every row it had pulled before, over the newer edits of another device.
   * It only needs the rows newer than the push cursor, so pushStore prunes it every round.
   */
  const echoCache = new Map<SyncStore, Map<string, string>>();
  const echoesOf = (store: SyncStore): Map<string, string> => {
    let map = echoCache.get(store);
    if (!map) {
      map = new Map<string, string>();
      try {
        const saved = JSON.parse(read(`echo.${store}`) ?? "{}") as Record<string, unknown>;
        for (const [id, at] of Object.entries(saved)) if (typeof at === "string") map.set(id, at);
      } catch {
        // A damaged value is treated as empty: the worst case is one repeated push, which the server accepts.
      }
      echoCache.set(store, map);
    }
    return map;
  };
  const saveEchoes = (store: SyncStore): void => {
    write(`echo.${store}`, JSON.stringify(Object.fromEntries(echoesOf(store))));
  };
  const isEcho = (store: SyncStore, row: SyncRow): boolean => echoesOf(store).get(row.id) === row.updatedAt;
  const resetCursors = (): void => {
    for (const store of SYNC_ORDER) {
      write(`pushSeq.${store}`, "0");
      write(`pull.${store}`, "");
      write(`echo.${store}`, "{}");
    }
    echoCache.clear();
  };

  let instanceReady: Promise<void> | null = null;
  const ensureInstance = (): Promise<void> => {
    if (!instanceReady) {
      instanceReady = repo.sync.instanceId().then((instance) => {
        const saved = read("instance");
        if (saved !== null && saved !== instance) resetCursors();
        write("instance", instance);
      }).catch((error) => {
        instanceReady = null;
        throw error;
      });
    }
    return instanceReady;
  };

  const pushCursor = async (store: SyncStore): Promise<number> => {
    await ensureInstance();
    let saved = read(`pushSeq.${store}`);
    if (saved === null) {
      const oldCursor = read(`push.${store}`);
      let migrated = 0;
      if (oldCursor !== null) {
        const upgradeMax = await repo.sync.upgradeMaxLocalSeq(store);
        if (upgradeMax !== null) migrated = Math.min(await repo.sync.maxLocalSeqThrough(store, oldCursor), upgradeMax);
      }
      saved = String(migrated);
      write(`pushSeq.${store}`, saved);
    }
    const seq = Number(saved);
    return Number.isSafeInteger(seq) && seq >= 0 ? seq : 0;
  };
  const pullCursor = (store: SyncStore): string | null => read(`pull.${store}`);

  // ---------- Pending count ----------
  let pendingToken = 0;
  async function refreshPending(): Promise<number> {
    const token = ++pendingToken;
    await ensureInstance();
    let count = 0;
    for (const store of SYNC_ORDER) {
      const rows = await repo.sync.listChangedAfterSeq(store, await pushCursor(store));
      count += rows.filter((row) => !isEcho(store, row)).length;
    }
    // A newer refresh started while this one read: its answer is the fresh one.
    if (token === pendingToken && userId !== null) setState({ pendingCount: count });
    return count;
  }

  // ---------- One store ----------

  /**
   * The server already holds a live row with the same unique key (same word, video or card word)
   * under another id: another device added it while this one was offline. The server's row
   * always wins: writing over another device's card is unsafe without a server transaction.
   * Adopting it uses a newer local time so applyRemote resolves the twin and moves review links.
   * Returns false when no twin was found or the conflict could not be settled.
   */
  async function adoptServerTwin(store: SyncStore, row: SyncRow): Promise<boolean> {
    const column = UNIQUE_COLUMNS[store];
    if (!column) return false;
    const value = toRemoteRow(store, row, userId ?? undefined)[column];
    if (typeof value !== "string") return false;
    const { data, error } = await client!.from(TABLES[store].table).select("*").eq(column, value);
    if (error) throw failureFrom(error);
    const twin = (data ?? []).find((raw) => raw.deleted_at == null && raw.id !== row.id);
    if (!twin) return false;
    // Strictly newer than the local twin, otherwise applyRemote would keep the local one.
    const adoptedAt = new Date(Math.max(Date.parse(String(twin.updated_at)), Date.parse(row.updatedAt) + 1)).toISOString();
    if (store === "cards") {
      const canonical = parseRemoteRow("cards", fromRemoteRow("cards", twin));
      if (!canonical) return false;
      await repo.sync.applyCardMerge(row, canonical as SyncRow);
      echoesOf(store).set(String(canonical.id), new Date(String(twin.updated_at)).toISOString());
      return true;
    }
    const result = await repo.sync.applyRemote(store, [{ ...fromRemoteRow(store, twin), updatedAt: adoptedAt }]);
    if (result.applied === 0) return false;
    echoesOf(store).set(String(fromRemoteRow(store, twin).id), adoptedAt);
    return true;
  }

  /** Pushes one store. Rows the server refuses one by one are added to `problems`; the round goes on. */
  async function pushStore(store: SyncStore, problems: string[], onlyIds?: ReadonlySet<string>): Promise<void> {
    // A concurrent write receives a sequence beyond this snapshot in its store transaction.
    const cursor = await pushCursor(store);
    const rows = await repo.sync.listChangedAfterSeq(store, cursor);
    const echo = echoesOf(store);
    // Forget rows that are no longer newer than the cursor.
    const listed = new Set(rows.map((row) => row.id));
    for (const id of [...echo.keys()]) if (!listed.has(id)) echo.delete(id);
    if (rows.length === 0) {
      saveEchoes(store);
      return;
    }
    const toSend = rows.filter((row) => !isEcho(store, row) && (!onlyIds || onlyIds.has(row.id)));
    const { table } = TABLES[store];
    const toRemote = (row: SyncRow) => toRemoteRow(store, row, userId ?? undefined);
    let failedFloor: number | null = null;
    const fail = (row: SyncRow, error: QueryError): void => {
      if (failedFloor === null || (row.localSeq ?? 0) < failedFloor) failedFloor = row.localSeq ?? 0;
      problems.push(error.message);
    };
    try {
      for (let start = 0; start < toSend.length; start += PUSH_CHUNK) {
        const chunk = toSend.slice(start, start + PUSH_CHUNK);
        const { error } = await client!.from(table).upsert(chunk.map(toRemote), { onConflict: "id" });
        if (!error) {
          for (const row of chunk) echo.set(row.id, row.updatedAt);
          continue;
        }
        // Only a unique-key or parent-row error is about single rows; anything else stops the round.
        if (!error.code || !ROW_ERROR_CODES.has(error.code)) throw failureFrom(error);
        // One bad row must not block the other 199: send them one at a time.
        for (const row of chunk) {
          const single = await client!.from(table).upsert([toRemote(row)], { onConflict: "id" });
          if (!single.error) {
            echo.set(row.id, row.updatedAt);
            continue;
          }
          if (!single.error.code || !ROW_ERROR_CODES.has(single.error.code)) throw failureFrom(single.error);
          if (single.error.code === "23505" && store === "cards" && client!.rpc) {
            try {
              const merged = await client!.rpc("eng_merge_card", { p_card: toRemote(row) });
              if (merged.error) {
                if (merged.error.code === "PGRST202" || merged.error.code === "42883") {
                  if (await adoptServerTwin(store, row)) continue;
                } else if (failureFrom(merged.error).offline) throw failureFrom(merged.error);
                fail(row, merged.error);
                continue;
              }
              const result = z.object({ canonical_id: z.string().min(1), selected: z.boolean(),
                card: z.record(z.string(), z.unknown()) }).parse(merged.data);
              const canonical = parseRemoteRow("cards", fromRemoteRow("cards", result.card));
              if (!canonical || canonical.id !== result.canonical_id) throw new Error("Invalid card merge response");
              await repo.sync.applyCardMerge(row, canonical as SyncRow);
              echo.set(result.canonical_id, new Date(String(result.card.updated_at)).toISOString());
              continue;
            } catch (caught) {
              const failure = failureFrom(caught);
              if (failure.offline) throw failure;
              fail(row, { message: failure.message });
              continue;
            }
          }
          // Other twins (and older clients without rpc) retain server-wins adoption.
          if (single.error.code === "23505" && (await adoptServerTwin(store, row))) continue;
          fail(row, single.error);
        }
      }
    } finally {
      saveEchoes(store);
    }
    if (onlyIds) return;
    // Advance only through this snapshot, stopping before the first refused sequence.
    let next = rows.reduce((max, row) => Math.max(row.localSeq ?? 0, max), cursor);
    if (failedFloor !== null) next = Math.min(next, failedFloor - 1);
    if (next > cursor) write(`pushSeq.${store}`, String(next));
  }

  async function pushCardBundles(problems: string[]): Promise<void> {
    if (!client!.rpc) {
      await pushStore("cards", problems);
      await pushStore("reviewLogs", problems);
      return;
    }
    const sent = {
      cards: (await repo.sync.listChangedAfterSeq("cards", await pushCursor("cards"))).filter((r) => !isEcho("cards", r)),
      reviewLogs: (await repo.sync.listChangedAfterSeq("reviewLogs", await pushCursor("reviewLogs"))).filter((r) => !isEcho("reviewLogs", r)),
    };
    const ids = new Set([...sent.cards.map((r) => r.id), ...sent.reviewLogs.map((r) => String(r.cardId))]);
    let failed = false;
    const pushBundle = async (id: string, card: SyncRow | undefined, logs: SyncRow[], allowMerge = true): Promise<void> => {
      const response = await client!.rpc!("eng_push_card_bundle", {
        p_card: card ? toRemoteRow("cards", card) : null,
        p_logs: logs.map((r) => toRemoteRow("reviewLogs", r)),
      });
      if (response.error) {
        if (response.error.code === "PGRST202" || response.error.code === "42883") {
          throw new Error("Card bundle function missing", { cause: response.error });
        }
        throw failureFrom(response.error);
      }
      const status = z.object({ status: z.enum(["ok", "merge"]) }).parse(response.data);
      if (status.status === "merge") {
        if (!allowMerge) throw new Error("Card redirected again during bundle push");
        const local = card ?? (await repo.sync.listChangedSince("cards", EPOCH)).find((r) => r.id === id);
        // A logs-only retry can retain the old id after the local loser was removed.
        const mergeCard = local ?? (logs[0]?.previousCard as SyncRow | undefined);
        if (!mergeCard) throw new Error("Missing card for bundle merge");
        // Preserve an offline undo while the loser still has no server card. Once
        // redirected, its parent snapshot may differ from the canonical history.
        if (logs.some((log) => log.deletedAt)) {
          const prepared = await client!.rpc!("eng_push_card_bundle", {
            p_card: null, p_logs: logs.map((r) => toRemoteRow("reviewLogs", r)),
          });
          if (prepared.error) throw failureFrom(prepared.error);
          // A pre-existing redirect returns merge without writes; resolve it below.
          z.object({ status: z.enum(["ok", "merge"]) }).parse(prepared.data);
        }
        const merged = await client!.rpc!("eng_merge_card", { p_card: toRemoteRow("cards", mergeCard) });
        if (merged.error) throw failureFrom(merged.error);
        const result = z.object({ canonical_id: z.string().min(1), selected: z.boolean(),
          card: z.record(z.string(), z.unknown()) }).parse(merged.data);
        const canonical = parseRemoteRow("cards", fromRemoteRow("cards", result.card)) as SyncRow | null;
        if (!canonical || canonical.id !== result.canonical_id) throw new Error("Invalid card merge response");
        await repo.sync.applyCardMerge(mergeCard, canonical);
        if (card) echoesOf("cards").set(card.id, card.updatedAt);
        echoesOf("cards").set(canonical.id, canonical.updatedAt);
        const moved = (await repo.sync.listChangedSince("reviewLogs", EPOCH))
          .filter((r) => r.cardId === canonical.id && !isEcho("reviewLogs", r));
        if (moved.length) await pushBundle(canonical.id, undefined, moved, false);
        return;
      }
      const raw = z.object({ card: z.record(z.string(), z.unknown()).nullable(),
        logs: z.array(z.record(z.string(), z.unknown())) }).parse(response.data);
      const returnedCard = raw.card ? parseRemoteRow("cards", fromRemoteRow("cards", raw.card)) as SyncRow | null : null;
      const returnedLogs = raw.logs.map((r) => parseRemoteRow("reviewLogs", fromRemoteRow("reviewLogs", r)) as SyncRow | null);
      if ((raw.card && (!returnedCard || returnedCard.id !== id)) || (card && !returnedCard) ||
        returnedLogs.some((r) => !r) || new Set(returnedLogs.map((r) => r!.id)).size !== logs.length ||
        logs.some((l) => !returnedLogs.some((r) => r!.id === l.id))) throw new Error("Invalid card bundle response");
      const group = { cards: card ? [card] : [], reviewLogs: logs };
      if (repo.sync.applyCardBundle) {
        await repo.sync.applyCardBundle(group, returnedCard, returnedLogs as SyncRow[]);
      } else {
        if (returnedCard) await repo.sync.applyRemote("cards", [returnedCard]);
        await repo.sync.applyRemote("reviewLogs", returnedLogs);
      }
      for (const store of ["cards", "reviewLogs"] as const) {
        for (const row of group[store]) echoesOf(store).set(row.id, row.updatedAt);
        // Only echo the returned version if that version actually reached the repository.
        const current = await repo.sync.listChangedSince(store, EPOCH);
        const returned = store === "cards" ? (returnedCard ? [returnedCard] : []) : returnedLogs as SyncRow[];
        for (const row of returned) if (current.some((r) => r.id === row.id && r.updatedAt === row.updatedAt)) {
          echoesOf(store).set(row.id, row.updatedAt);
        }
      }
    };
    try {
      for (const id of ids) {
        const card = sent.cards.find((r) => r.id === id);
        const logs = sent.reviewLogs.filter((r) => r.cardId === id);
        try {
          await pushBundle(id, card, logs);
        } catch (caught) {
          if (caught instanceof Error && caught.message === "Card bundle function missing") {
            await pushStore("cards", problems);
            await pushStore("reviewLogs", problems);
            return;
          }
          const failure = failureFrom(caught);
          if (failure.offline) throw failure;
          failed = true;
          for (const _row of [...(card ? [card] : []), ...logs]) problems.push(failure.message);
        }
      }
      if (!failed) for (const store of ["cards", "reviewLogs"] as const) {
        const cursor = await pushCursor(store);
        const next = sent[store].reduce((max, row) => Math.max(row.localSeq ?? 0, max), cursor);
        if (next > cursor) write(`pushSeq.${store}`, String(next));
      }
    } finally {
      saveEchoes("cards");
      saveEchoes("reviewLogs");
    }
  }

  /** Postgres gives "...123456+00:00"; a filter value needs "Z" ("+" would be read as a space) and keeps the microseconds. */
  const filterTime = (raw: unknown): string => {
    const text = String(raw);
    return /\+00:00$/.test(text) ? text.replace(/\+00:00$/, "Z") : new Date(text).toISOString();
  };

  async function pullStore(store: SyncStore): Promise<void> {
    const last = pullCursor(store);
    const since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : EPOCH;
    const { table } = TABLES[store];
    const echo = echoesOf(store);
    let newest = last ?? "";
    // Keyset paging: every page asks for rows AFTER the last row of the previous page, ordered by
    // (updated_at, id). Offset paging skipped rows when the data moved between two page requests,
    // and many rows of one push share one updated_at, so the order needs the id as a tiebreaker.
    let after: { time: string; id: string } | null = null;
    try {
      for (;;) {
        let query = client!.from(table).select("*");
        query = after
          ? query.or(`updated_at.gt.${after.time},and(updated_at.eq.${after.time},id.gt."${after.id.replace(/"/g, '\\"')}")`)
          : query.gt("updated_at", since);
        const { data, error } = await query
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .range(0, PAGE_SIZE - 1);
        if (error) throw failureFrom(error);
        const page = data ?? [];
        if (page.length > 0) {
          const rows = page.map((raw) => fromRemoteRow(store, raw));
          // Evaluate the local version inside applyRemote's write transaction: an undo may
          // commit after this response but before that transaction starts.
          const cursor = await pushCursor(store);
          const protectedIds = new Set<string>();
          const isPending = store === "cards" || store === "reviewLogs" ? (row: SyncRow): boolean => {
            const pending = (row.localSeq ?? 0) > cursor && !isEcho(store, row);
            if (pending) protectedIds.add(row.id);
            return pending;
          } : undefined;
          await repo.sync.applyRemote(store, rows, isPending);
          page.forEach((raw, index) => {
            // Same normalisation as syncSchemas.ts: Postgres sends microseconds and "+00:00".
            const updatedAt = new Date(String(raw.updated_at)).toISOString();
            if (!protectedIds.has(String(rows[index]?.id))) echo.set(String(rows[index]?.id), updatedAt);
            if (updatedAt > newest) newest = updatedAt;
          });
          const lastRaw = page[page.length - 1]!;
          after = { time: filterTime(lastRaw.updated_at), id: String(lastRaw.id) };
          // Persist per page: a failure on page 3 keeps the progress of pages 1 and 2.
          if (newest) write(`pull.${store}`, newest);
        }
        if (page.length < PAGE_SIZE) break;
      }
    } finally {
      saveEchoes(store);
    }
  }

  // ---------- A full round ----------
  let running: Promise<void> | null = null;
  let again = false;

  const enabled = (): boolean => client !== null && userId !== null;

  async function round(): Promise<void> {
    if (!enabled()) {
      setState({ status: "disabled", pendingCount: 0 });
      return;
    }
    if (!isOnline()) {
      setState({ status: "offline" });
      await refreshPending();
      return;
    }
    setState({ status: "syncing" });
    try {
      const problems: string[] = [];
      for (const store of SYNC_ORDER) {
        if (store === "reviewLogs") continue; // Pushed/pulled with cards below.
        if (store === "cards") {
          await pushCardBundles(problems);
          await pullStore("cards");
          await pullStore("reviewLogs");
        } else {
          await pushStore(store, problems);
          await pullStore(store);
        }
      }
      if (problems.length > 0) {
        // The rest of the round went through; only these rows are waiting. They are retried each round.
        setState({ status: "error", lastError: `${problems.length} değişiklik sunucuda çakıştı ve gönderilemedi: ${problems[0]}` });
      } else {
        const finishedAt = now().toISOString();
        write("lastSyncedAt", finishedAt);
        setState({ status: "idle", lastSyncedAt: finishedAt, lastError: null });
      }
    } catch (caught) {
      const failure = failureFrom(caught);
      setState({ status: failure.offline ? "offline" : "error", lastError: failure.message });
    }
    await refreshPending();
  }

  function syncNow(): Promise<void> {
    if (running) {
      // A change arrived during a round: run one more round afterwards instead of racing it.
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await round();
        } while (again && enabled());
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // ---------- Triggers ----------
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (delay: number): void => {
    if (!enabled()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow();
    }, delay);
  };

  let channel: RealtimeChannelLike | null = null;
  const closeRealtime = (): void => {
    if (channel && client?.removeChannel) client.removeChannel(channel);
    channel = null;
  };
  const openRealtime = (): void => {
    if (channel || !client?.channel) return;
    // Any change of the user's rows (made on another device) starts a round. RLS makes sure the
    // server only sends this user's rows. Our own pushes echo back here too; the round that
    // follows finds nothing new, so it ends after one pull.
    let next = client.channel("eng-learn-sync");
    for (const store of SYNC_ORDER) {
      next = next.on("postgres_changes", { event: "*", schema: "public", table: TABLES[store].table }, () => schedule(500));
    }
    next.subscribe();
    channel = next;
  };

  /** The account that signed in while another account's data is still on this device. */
  let switchTo: string | null = null;

  function activate(next: string): void {
    userId = next;
    if (started) openRealtime();
    setState({ foreignData: false });
    // Signing in (or an app start that finds a session): sync right away.
    void syncNow();
  }

  function setUser(next: string | null): void {
    const previous = userId;
    const stored = read("user");
    if (next === null || !client) {
      userId = null;
      switchTo = null;
      if (timer) clearTimeout(timer);
      timer = null;
      closeRealtime();
      setState({ status: "disabled", pendingCount: 0, foreignData: false });
      return;
    }
    if (stored !== null && stored !== next) {
      // The local data and the cursors belong to another account. Uploading it unasked would put
      // that account's words and reports into this one, so wait for the user's answer.
      userId = null;
      switchTo = next;
      if (timer) clearTimeout(timer);
      timer = null;
      closeRealtime();
      setState({ status: "disabled", pendingCount: 0, foreignData: true });
      return;
    }
    switchTo = null;
    if (stored === null) write("user", next);
    if (previous === next) return;
    activate(next);
  }

  async function confirmUserSwitch(choice: "clear" | "keep"): Promise<void> {
    const next = switchTo;
    if (next === null || !client) return;
    switchTo = null;
    if (choice === "clear") await repo.sync.clearLocalData();
    // Cursors belong to one account: the new account starts from the beginning, otherwise its
    // rows older than the old cursor would never be pulled.
    resetCursors();
    write("user", next);
    activate(next);
    await syncNow();
  }

  function start(): () => void {
    if (started) return () => {};
    started = true;
    const unsubscribe = repo.subscribe(() => {
      if (!enabled()) return;
      // Only local changes that are NOT echoes of a pull count. Without this check, pulling a
      // row would notify, which would schedule a round, which would pull again.
      void refreshPending().then((count) => {
        if (count > 0) schedule(debounceMs);
      });
    });
    const onOnline = (): void => {
      void syncNow();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void syncNow();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (enabled()) openRealtime();
    return () => {
      started = false;
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
      closeRealtime();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setUser,
    confirmUserSwitch,
    syncNow,
    start,
  };
}
