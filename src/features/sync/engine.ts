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
// Conflicts are "last write wins" and are decided by `updated_at`, which the server stamps.

import type { Repository, SyncRow, SyncStore } from "../../data";
import { SYNC_ORDER, TABLES, fromRemoteRow, toRemoteRow } from "./mapping";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "disabled";

export interface SyncState {
  status: SyncStatus;
  /** Local changes that are not on the server yet. */
  pendingCount: number;
  /** ISO time of the last round that finished without an error, or null. */
  lastSyncedAt: string | null;
  /** The reason of the last failed round, or null. */
  lastError: string | null;
}

// ---------- The small part of the Supabase client the engine uses ----------
// Declared here (instead of importing SupabaseClient) so tests can pass a plain fake object.
// The real client matches this shape; the cast happens in one place, in runtime.ts.

interface QueryError {
  message: string;
}
interface SelectQuery extends PromiseLike<{ data: Array<Record<string, unknown>> | null; error: QueryError | null }> {
  gt(column: string, value: string): SelectQuery;
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
    if (next.status === state.status && next.pendingCount === state.pendingCount && next.lastSyncedAt === state.lastSyncedAt && next.lastError === state.lastError) {
      return;
    }
    // A new object every time: useSyncExternalStore compares snapshots by reference.
    state = next;
    for (const listener of listeners) listener();
  };

  /**
   * Rows that came FROM the server in this session (id -> updatedAt). They changed locally too
   * (applyRemote wrote them), but pushing them back would make the server bump `updated_at`,
   * which we would pull again, and so on forever. The cursor skips old ones; this map skips the
   * ones that arrived since.
   */
  const echoes = new Map<string, string>();
  const isEcho = (store: SyncStore, row: SyncRow): boolean => echoes.get(`${store}:${row.id}`) === row.updatedAt;

  const pushCursor = (store: SyncStore): string => read(`push.${store}`) ?? EPOCH;
  const pullCursor = (store: SyncStore): string | null => read(`pull.${store}`);

  // ---------- Pending count ----------
  let pendingToken = 0;
  async function refreshPending(): Promise<number> {
    const token = ++pendingToken;
    let count = 0;
    for (const store of SYNC_ORDER) {
      const rows = await repo.sync.listChangedSince(store, pushCursor(store));
      count += rows.filter((row) => !isEcho(store, row)).length;
    }
    // A newer refresh started while this one read: its answer is the fresh one.
    if (token === pendingToken && userId !== null) setState({ pendingCount: count });
    return count;
  }

  // ---------- One store ----------
  async function pushStore(store: SyncStore): Promise<void> {
    const rows = await repo.sync.listChangedSince(store, pushCursor(store));
    if (rows.length === 0) return;
    const toSend = rows.filter((row) => !isEcho(store, row));
    const { table } = TABLES[store];
    for (let start = 0; start < toSend.length; start += PUSH_CHUNK) {
      const chunk = toSend.slice(start, start + PUSH_CHUNK).map((row) => toRemoteRow(store, row));
      const { error } = await client!.from(table).upsert(chunk, { onConflict: "id" });
      if (error) throw failureFrom(error);
    }
    // Move the cursor only after every chunk succeeded, so a failure retries the whole store.
    // Rows are oldest first, but take the max anyway instead of trusting the order.
    const newest = rows.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), pushCursor(store));
    write(`push.${store}`, newest);
  }

  async function pullStore(store: SyncStore): Promise<void> {
    const last = pullCursor(store);
    const since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : EPOCH;
    const { table } = TABLES[store];
    let newest = last ?? "";
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client!
        .from(table)
        .select("*")
        .gt("updated_at", since)
        .order("updated_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw failureFrom(error);
      const page = data ?? [];
      if (page.length > 0) {
        const rows = page.map((raw) => fromRemoteRow(store, raw));
        await repo.sync.applyRemote(store, rows);
        for (const raw of page) {
          // Same normalisation as syncSchemas.ts: Postgres sends microseconds and "+00:00".
          const updatedAt = new Date(String(raw.updated_at)).toISOString();
          echoes.set(`${store}:${String(raw.id)}`, updatedAt);
          if (updatedAt > newest) newest = updatedAt;
        }
        // Persist per page: a failure on page 3 keeps the progress of pages 1 and 2.
        if (newest) write(`pull.${store}`, newest);
      }
      if (page.length < PAGE_SIZE) break;
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
      for (const store of SYNC_ORDER) {
        await pushStore(store);
        await pullStore(store);
      }
      const finishedAt = now().toISOString();
      write("lastSyncedAt", finishedAt);
      setState({ status: "idle", lastSyncedAt: finishedAt, lastError: null });
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

  function setUser(next: string | null): void {
    const previous = userId;
    // Cursors belong to one account. A different account must start from the beginning,
    // otherwise its rows older than the old cursor would never be pulled.
    if (next !== null && next !== read("user")) {
      if (read("user") !== null) {
        for (const store of SYNC_ORDER) {
          write(`push.${store}`, EPOCH);
          write(`pull.${store}`, "");
        }
      }
      write("user", next);
    }
    userId = next;
    if (!client || next === null) {
      if (timer) clearTimeout(timer);
      timer = null;
      closeRealtime();
      setState({ status: "disabled", pendingCount: 0 });
      return;
    }
    if (previous === next) return;
    if (started) openRealtime();
    // Signing in (or an app start that finds a session): sync right away.
    void syncNow();
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
    syncNow,
    start,
  };
}
