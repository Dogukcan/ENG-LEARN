// Engine tests with a fake repository and a fake Supabase client: no network, no IndexedDB.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyRemoteResult, Repository, SyncRow, SyncStore } from "../../data";
import { PULL_OVERLAP_MS, createSyncEngine } from "./engine";
import type { SyncClient, SyncEngine } from "./engine";
import { SYNC_ORDER, TABLES } from "./mapping";

const T0 = Date.parse("2026-11-17T10:00:00.000Z");
const iso = (offsetSeconds: number): string => new Date(T0 + offsetSeconds * 1000).toISOString();

/** In-memory stand-in for the repository's sync door. */
function fakeRepo() {
  const rows = new Map<SyncStore, SyncRow[]>(SYNC_ORDER.map((store) => [store, []]));
  const listeners = new Set<() => void>();
  const applied: Array<{ store: SyncStore; rows: unknown[] }> = [];
  const repo = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync: {
      listChangedSince: async (store: SyncStore, since: string) =>
        (rows.get(store) ?? []).filter((row) => row.updatedAt > since),
      applyRemote: async (store: SyncStore, incoming: unknown[]): Promise<ApplyRemoteResult> => {
        applied.push({ store, rows: incoming });
        for (const raw of incoming as Array<Record<string, unknown>>) {
          const updatedAt = new Date(String(raw.updatedAt)).toISOString();
          const list = rows.get(store) ?? [];
          const index = list.findIndex((row) => row.id === raw.id);
          const row = { ...raw, updatedAt } as SyncRow;
          if (index >= 0) list[index] = row;
          else list.push(row);
        }
        return { applied: incoming.length, skipped: 0, conflicts: 0, invalid: 0 };
      },
    },
  } as unknown as Pick<Repository, "sync" | "subscribe">;
  return {
    repo,
    rows,
    applied,
    /** A local write: stores the row and notifies like the real repository. */
    write(store: SyncStore, row: SyncRow) {
      rows.get(store)?.push(row);
      for (const listener of [...listeners]) listener();
    },
  };
}

type Call = { table: string; kind: "upsert" | "select"; payload?: unknown; since?: string };

/** Fake Supabase client: remembers calls, serves rows from `server`, can be told to fail. */
function fakeClient(server: Record<string, Array<Record<string, unknown>>> = {}) {
  const calls: Call[] = [];
  const state = { failWith: null as string | null };
  const client: SyncClient = {
    from(table: string) {
      return {
        upsert: async (payload: Array<Record<string, unknown>>) => {
          calls.push({ table, kind: "upsert", payload });
          return { error: state.failWith ? { message: state.failWith } : null };
        },
        select() {
          const call: Call = { table, kind: "select" };
          let from = 0;
          let to = 999;
          const query = {
            gt(_column: string, value: string) {
              call.since = value;
              return query;
            },
            order: () => query,
            range(a: number, b: number) {
              from = a;
              to = b;
              return query;
            },
            then(resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => unknown) {
              calls.push(call);
              const data = (server[table] ?? []).filter((row) => String(row.updated_at) > (call.since ?? "")).slice(from, to + 1);
              return Promise.resolve(
                resolve(state.failWith ? { data: null, error: { message: state.failWith } } : { data, error: null }),
              );
            },
          };
          return query as never;
        },
      };
    },
  };
  return { client, calls, state, server };
}

function setup(options: { server?: Record<string, Array<Record<string, unknown>>>; online?: boolean } = {}) {
  const repo = fakeRepo();
  const net = fakeClient(options.server);
  let online = options.online ?? true;
  const engine: SyncEngine = createSyncEngine({
    repo: repo.repo,
    client: net.client,
    now: () => new Date(T0 + 60_000),
    storage: null,
    isOnline: () => online,
  });
  return { repo, net, engine, setOnline: (value: boolean) => (online = value) };
}

const book = (id: string, updatedAt: string): SyncRow => ({ id, title: "Reader at Work 1", shortName: "RW1", unit: 1, page: 1, updatedAt });

afterEach(() => {
  vi.useRealTimers();
});

describe("sync engine", () => {
  it("is disabled without a client or without a signed-in user, and never calls the network", async () => {
    const repo = fakeRepo();
    const noClient = createSyncEngine({ repo: repo.repo, client: null, now: () => new Date(), storage: null });
    noClient.setUser("u1");
    await noClient.syncNow();
    expect(noClient.getState().status).toBe("disabled");

    const net = fakeClient();
    const signedOut = createSyncEngine({ repo: repo.repo, client: net.client, now: () => new Date(), storage: null });
    await signedOut.syncNow();
    expect(signedOut.getState().status).toBe("disabled");
    expect(net.calls).toHaveLength(0);
  });

  it("pushes changed rows to the matching table with snake_case columns, in the fixed store order", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    repo.rows.get("inbox")!.push({
      id: "i1",
      word: "Harbor",
      source: { kind: "diger" },
      createdAt: iso(2),
      updatedAt: iso(2),
    });
    engine.setUser("u1");
    await engine.syncNow();

    const upserts = net.calls.filter((call) => call.kind === "upsert");
    expect(upserts.map((call) => call.table)).toEqual(["eng_books", "eng_inbox"]);
    expect(upserts[0]?.payload).toEqual([
      { id: "b1", deleted_at: null, title: "Reader at Work 1", short_name: "RW1", unit: 1, page: 1 },
    ]);
    expect(upserts[1]?.payload).toMatchObject([{ id: "i1", normalized: "harbor", sentence: null }]);
    // Per store: push then pull, books first.
    expect(net.calls.map((call) => `${call.kind}:${call.table}`).slice(0, 3)).toEqual([
      "upsert:eng_books",
      "select:eng_books",
      "select:eng_settings",
    ]);
    expect(engine.getState()).toMatchObject({ status: "idle", pendingCount: 0, lastError: null, lastSyncedAt: iso(60) });
  });

  it("does not push the same rows twice (push cursor)", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    engine.setUser("u1");
    await engine.syncNow();
    await engine.syncNow();
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(1);
  });

  it("pulls server rows and hands them to applyRemote as camelCase", async () => {
    const server = {
      eng_words: [
        {
          id: "w1",
          user_id: "u1",
          lemma: "harbour",
          normalized: "harbour",
          status: "learning",
          source: { kind: "diger" },
          created_at: "2026-11-17T09:00:00+00:00",
          updated_at: "2026-11-17T09:30:00.123456+00:00",
          deleted_at: null,
        },
      ],
    };
    const { repo, engine } = setup({ server });
    engine.setUser("u1");
    await engine.syncNow();
    const call = repo.applied.find((entry) => entry.store === "words");
    expect(call?.rows).toEqual([
      expect.objectContaining({ id: "w1", lemma: "harbour", updatedAt: "2026-11-17T09:30:00.123456+00:00", createdAt: "2026-11-17T09:00:00+00:00" }),
    ]);
  });

  it("does not push a row it just pulled (no echo loop) and reports nothing pending", async () => {
    const server = {
      eng_books: [{ id: "b9", title: "t", short_name: "RW2", unit: 1, page: 1, created_at: null, updated_at: iso(5), deleted_at: null }],
    };
    const { net, engine } = setup({ server });
    engine.setUser("u1");
    await engine.syncNow();
    await engine.syncNow();
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(0);
    expect(engine.getState().pendingCount).toBe(0);
  });

  it("starts the next pull 2 seconds before the newest row it has seen", async () => {
    const server = {
      eng_books: [{ id: "b9", title: "t", short_name: "RW2", unit: 1, page: 1, updated_at: iso(100), deleted_at: null }],
    };
    const { net, engine } = setup({ server });
    engine.setUser("u1");
    await engine.syncNow();
    net.calls.length = 0;
    await engine.syncNow();
    const bookPull = net.calls.find((call) => call.kind === "select" && call.table === "eng_books");
    expect(PULL_OVERLAP_MS).toBe(2000);
    expect(bookPull?.since).toBe(iso(98));
  });

  it("goes offline without touching the network, keeps the pending count, and recovers", async () => {
    const { repo, net, engine, setOnline } = setup({ online: false });
    repo.rows.get("books")!.push(book("b1", iso(1)));
    engine.setUser("u1");
    await engine.syncNow();
    expect(engine.getState()).toMatchObject({ status: "offline", pendingCount: 1 });
    expect(net.calls).toHaveLength(0);

    setOnline(true);
    await engine.syncNow();
    expect(engine.getState()).toMatchObject({ status: "idle", pendingCount: 0 });
  });

  it("treats a failed fetch as offline", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    net.state.failWith = "TypeError: Failed to fetch";
    engine.setUser("u1");
    await engine.syncNow();
    expect(engine.getState().status).toBe("offline");
  });

  it("reports a server error, keeps the data pending, and retries the same rows next time", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    net.state.failWith = "new row violates row-level security policy";
    engine.setUser("u1");
    await engine.syncNow();
    expect(engine.getState()).toMatchObject({ status: "error", pendingCount: 1, lastError: "new row violates row-level security policy" });

    // The failed round did not move the push cursor, so the same row is sent again.
    net.state.failWith = null;
    net.calls.length = 0;
    await engine.syncNow();
    expect(engine.getState()).toMatchObject({ status: "idle", pendingCount: 0, lastError: null });
    const retries = net.calls.filter((call) => call.kind === "upsert" && call.table === TABLES.books.table);
    expect(retries).toHaveLength(1);
    expect(retries[0]?.payload).toMatchObject([{ id: "b1" }]);
  });

  it("shares one round between overlapping syncNow calls", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    engine.setUser("u1");
    await Promise.all([engine.syncNow(), engine.syncNow()]);
    // The second call asked for one more round, which finds nothing to push.
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(1);
  });

  it("syncs once, 2 seconds after the last local change", async () => {
    vi.useFakeTimers();
    const { repo, net, engine } = setup();
    engine.setUser("u1");
    await vi.advanceTimersByTimeAsync(0);
    engine.start();
    net.calls.length = 0;

    repo.write("books", book("b1", iso(1)));
    await vi.advanceTimersByTimeAsync(1000);
    repo.write("books", book("b2", iso(2)));
    await vi.advanceTimersByTimeAsync(1900);
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    const upserts = net.calls.filter((call) => call.kind === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.payload).toHaveLength(2);
  });

  it("signing out stops syncing and keeps local data", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("books")!.push(book("b1", iso(1)));
    engine.setUser("u1");
    await engine.syncNow();
    engine.setUser(null);
    expect(engine.getState().status).toBe("disabled");
    net.calls.length = 0;
    await engine.syncNow();
    expect(net.calls).toHaveLength(0);
    expect(repo.rows.get("books")).toHaveLength(1);
  });
});
