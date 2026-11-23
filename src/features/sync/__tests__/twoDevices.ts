import { vi } from "vitest";
import { createIndexedDbRepository } from "../../../data/indexeddb";
import { createSyncEngine } from "../engine";
import type { SyncClient, SyncStorage } from "../engine";
import { TABLES, UNIQUE_COLUMNS } from "../mapping";

type Row = Record<string, unknown>;
type QueryError = { code: string; message: string };
type Result = { error: QueryError | null };

export const LOCAL_TIME = new Date("2026-11-24T12:00:00.000Z");
export const USER_ID = "two-device-user";

/** Only the SQL rules exercised by sync: RLS, the stale-edit trigger and partial unique keys. */
export function createSharedServer() {
  const tables = new Map<string, Map<string, Row>>();
  let clock = LOCAL_TIME.getTime() + 1000;
  const tableOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const uniqueColumns = new Map(Object.entries(UNIQUE_COLUMNS).map(([store, column]) => [
    TABLES[store as keyof typeof TABLES].table, column,
  ]));

  function write(name: string, rows: Row[], upsert = false): Result {
    // One statement shares one server timestamp, even when it writes several rows.
    const at = new Date(clock).toISOString();
    clock += 1;
    if (upsert && new Set(rows.map((row) => row.id)).size !== rows.length) {
      return { error: { code: "21000", message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
    }
    // A failed chunk must leave every row untouched, including rows before the conflict.
    const next = new Map(tableOf(name));
    for (const input of rows) {
      const old = next.get(String(input.id));
      const row: Row = { ...old, ...structuredClone(input), user_id: input.user_id ?? old?.user_id ?? USER_ID };
      if (row.user_id !== USER_ID || (old && old.user_id !== USER_ID)) {
        return { error: { code: "42501", message: "new row violates row-level security policy" } };
      }
      // Migration 0003 compares against OLD.updated_at, not OLD.client_updated_at. RETURN OLD
      // silently accepts the request without changing the stored row or its timestamp.
      if (old && row.client_updated_at != null && Date.parse(String(row.client_updated_at)) < Date.parse(String(old.updated_at))) continue;
      const column = uniqueColumns.get(name);
      if (column && row.deleted_at == null && row[column] != null && [...next.values()].some((other) =>
        other.id !== row.id && other.user_id === row.user_id && other.deleted_at == null && other[column] === row[column],
      )) {
        return { error: { code: "23505", message: `duplicate key value violates unique constraint on ${name} (user_id, ${column})` } };
      }
      next.set(String(row.id), { ...row, updated_at: at });
    }
    tables.set(name, next);
    return { error: null };
  }

  const client = {
    from(name: string) {
      return {
        upsert: async (rows: Row[], options: { onConflict: string }) => {
          if (options.onConflict !== "id") throw new Error(`unexpected conflict target ${options.onConflict}`);
          return write(name, rows, true);
        },
        update(patch: Row) {
          const filters: Array<(row: Row) => boolean> = [];
          const query = {
            eq(column: string, value: string) {
              filters.push((row) => row[column] === value);
              return query;
            },
            then<TResult1 = Result, TResult2 = never>(
              resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
              reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              const rows = [...tableOf(name).values()].filter((row) => row.user_id === USER_ID && filters.every((filter) => filter(row)));
              return Promise.resolve(write(name, rows.map((row) => ({ ...row, ...patch })))).then(resolve, reject);
            },
          };
          return query;
        },
        select(columns: string) {
          if (columns !== "*") throw new Error(`unexpected select ${columns}`);
          const filters: Array<(row: Row) => boolean> = [];
          const ordering: Array<{ column: string; ascending: boolean }> = [];
          let from = 0;
          let to = Number.POSITIVE_INFINITY;
          const query = {
            gt(column: string, value: string) {
              filters.push((row) => String(row[column]) > value);
              return query;
            },
            eq(column: string, value: string) {
              filters.push((row) => row[column] === value);
              return query;
            },
            or(filter: string) {
              const match = /^updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\."(.*)"\)$/.exec(filter);
              if (!match) throw new Error(`unexpected filter ${filter}`);
              const time = Date.parse(match[1]!);
              const id = match[3]!.replace(/\\"/g, '"');
              filters.push((row) => Date.parse(String(row.updated_at)) > time ||
                (Date.parse(String(row.updated_at)) === time && String(row.id) > id));
              return query;
            },
            order(column: string, options: { ascending: boolean }) {
              ordering.push({ column, ...options });
              return query;
            },
            range(start: number, end: number) {
              from = start;
              to = end;
              return query;
            },
            then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
              resolve?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
              reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              const data = [...tableOf(name).values()]
                .filter((row) => row.user_id === USER_ID && filters.every((filter) => filter(row)))
                .sort((a, b) => {
                  for (const { column, ascending } of ordering) {
                    const comparison = String(a[column]).localeCompare(String(b[column]));
                    if (comparison) return ascending ? comparison : -comparison;
                  }
                  return 0;
                }).slice(from, to + 1);
              return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
  // Keep update available for SQL behavior tests without extending the engine's client API.
  client satisfies SyncClient;
  return {
    client, tableOf,
    now: () => new Date(clock),
    advance: (ms: number) => { clock += ms; },
  };
}

export function createDevice(server: ReturnType<typeof createSharedServer>, { skewMs = 0 } = {}) {
  let offset = skewMs;
  const now = () => new Date(server.now().getTime() + offset);
  async function run<T>(action: () => Promise<T>): Promise<T> {
    const previous = new Date();
    vi.setSystemTime(now());
    try {
      return await action();
    } finally {
      vi.setSystemTime(previous);
    }
  }
  const repo = createIndexedDbRepository(`eng-learn-two-devices-${crypto.randomUUID()}`);
  const values = new Map<string, string>();
  const storage: SyncStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const engine = createSyncEngine({ repo, client: server.client, now: () => new Date(), storage, isOnline: () => true });
  return { repo, engine, storage, now, run, advance: (ms: number) => { offset += ms; }, signedIn: false };
}

export function createTwoDevices(bOptions: { skewMs?: number } = {}) {
  const server = createSharedServer();
  return { server, a: createDevice(server), b: createDevice(server, bOptions) };
}

/** setUser already starts the first round; wait on its status without asking for an extra round. */
export async function syncRound(device: ReturnType<typeof createDevice>): Promise<void> {
  await device.run(async () => {
    if (!device.signedIn) {
      device.signedIn = true;
      await new Promise<void>((resolve) => {
        const unsubscribe = device.engine.subscribe(() => {
          const status = device.engine.getState().status;
          if (status === "idle" || status === "error" || status === "offline") {
            unsubscribe();
            resolve();
          }
        });
        device.engine.setUser(USER_ID);
      });
    } else {
      await device.engine.syncNow();
    }
    const state = device.engine.getState();
    if (state.status !== "idle") throw new Error(`sync failed: ${state.lastError ?? state.status}`);
  });
}
