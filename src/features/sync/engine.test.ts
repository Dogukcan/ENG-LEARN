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
  let cleared = 0;
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
      clearLocalData: async () => {
        cleared += 1;
        for (const list of rows.values()) list.length = 0;
      },
    },
  } as unknown as Pick<Repository, "sync" | "subscribe">;
  return {
    repo,
    rows,
    applied,
    clearedCount: () => cleared,
    /** A local write: stores the row and notifies like the real repository. */
    write(store: SyncStore, row: SyncRow) {
      rows.get(store)?.push(row);
      for (const listener of [...listeners]) listener();
    },
  };
}

type Call = { table: string; kind: "upsert" | "select"; payload?: unknown; since?: string; filter?: string };
type Rejection = { message: string; code?: string };

/** Fake Supabase client: remembers calls, serves rows from `server`, can be told to fail. */
function fakeClient(server: Record<string, Array<Record<string, unknown>>> = {}) {
  const calls: Call[] = [];
  const state = {
    failWith: null as string | null,
    /** Return an error to refuse a single upsert request; null accepts it. */
    reject: null as null | ((table: string, payload: Array<Record<string, unknown>>) => Rejection | null),
  };
  const client: SyncClient = {
    from(table: string) {
      return {
        upsert: async (payload: Array<Record<string, unknown>>) => {
          calls.push({ table, kind: "upsert", payload });
          if (state.failWith) return { error: { message: state.failWith } };
          return { error: state.reject?.(table, payload) ?? null };
        },
        select() {
          const call: Call = { table, kind: "select" };
          let to = 999;
          let predicate: (row: Record<string, unknown>) => boolean = () => true;
          const query = {
            gt(_column: string, value: string) {
              call.since = value;
              predicate = (row) => String(row.updated_at) > value;
              return query;
            },
            eq(column: string, value: string) {
              predicate = (row) => row[column] === value;
              return query;
            },
            // Understands only the keyset filter the engine writes.
            or(filter: string) {
              call.filter = filter;
              const match = /^updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\."(.*)"\)$/.exec(filter);
              if (!match) throw new Error(`unexpected filter ${filter}`);
              const time = Date.parse(match[1]!.replace(/Z$/, "+00:00"));
              predicate = (row) => {
                const at = Date.parse(String(row.updated_at));
                return at > time || (at === time && String(row.id) > match[3]!);
              };
              return query;
            },
            order: () => query,
            range(_a: number, b: number) {
              to = b;
              return query;
            },
            then(resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => unknown) {
              calls.push(call);
              const data = (server[table] ?? [])
                .filter(predicate)
                .sort((x, y) => Date.parse(String(x.updated_at)) - Date.parse(String(y.updated_at)) || String(x.id).localeCompare(String(y.id)))
                .slice(0, to + 1);
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

function setup(options: { server?: Record<string, Array<Record<string, unknown>>>; online?: boolean; clock?: () => Date } = {}) {
  const repo = fakeRepo();
  const net = fakeClient(options.server);
  let online = options.online ?? true;
  const engine: SyncEngine = createSyncEngine({
    repo: repo.repo,
    client: net.client,
    now: options.clock ?? (() => new Date(T0 + 60_000)),
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
      { id: "b1", deleted_at: null, client_updated_at: iso(1), title: "Reader at Work 1", short_name: "RW1", unit: 1, page: 1 },
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

  // ---------- Review findings ----------

  const wordRow = (id: string, lemma: string, updatedAt: string): SyncRow => ({
    id,
    lemma,
    status: "learning",
    source: { kind: "diger" },
    createdAt: updatedAt,
    updatedAt,
  });
  const serverWord = (id: string, lemma: string, updatedAt: string) => ({
    id,
    lemma,
    normalized: lemma,
    status: "learning",
    source: { kind: "diger" },
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
  });
  const duplicateKey = (table: string, payload: Array<Record<string, unknown>>): Rejection | null =>
    table === "eng_words" && payload.some((row) => row.id === "w-local")
      ? { message: 'duplicate key value violates unique constraint "eng_words_user_normalized_uq"', code: "23505" }
      : null;

  it("a unique-key conflict (23505) adopts the server's twin and does not block the later stores", async () => {
    const { repo, net, engine } = setup({ server: { eng_words: [serverWord("w-server", "apple", iso(10))] } });
    repo.rows.get("words")!.push(wordRow("w-local", "apple", iso(20)));
    repo.rows.get("activity")!.push({ id: "a1", block: "okuma", startedAt: iso(30), seconds: 60, source: "timer", updatedAt: iso(30) });
    net.state.reject = duplicateKey;
    engine.setUser("u1");
    await engine.syncNow();

    // The round reached the activity store (it used to stop at words).
    expect(net.calls.some((call) => call.kind === "upsert" && call.table === "eng_activity")).toBe(true);
    // The server's twin was applied with a time newer than the local twin, so it wins locally.
    const adopted = repo.applied.find((entry) => entry.store === "words" && (entry.rows as Array<{ id: string }>)[0]?.id === "w-server");
    expect(adopted).toBeDefined();
    expect((adopted!.rows[0] as { updatedAt: string }).updatedAt > iso(20)).toBe(true);
    expect(engine.getState()).toMatchObject({ status: "idle", lastError: null });
  });

  it("a unique-key conflict without a server twin is skipped with lastError, and the other rows still go", async () => {
    const { repo, net, engine } = setup();
    repo.rows.get("words")!.push(wordRow("w-local", "apple", iso(20)), wordRow("w-ok", "pear", iso(21)));
    repo.rows.get("activity")!.push({ id: "a1", block: "okuma", startedAt: iso(30), seconds: 60, source: "timer", updatedAt: iso(30) });
    net.state.reject = duplicateKey;
    engine.setUser("u1");
    await engine.syncNow();

    const wordCalls = net.calls.filter((call) => call.kind === "upsert" && call.table === "eng_words");
    // Chunk (refused) -> one by one: w-local refused, w-ok accepted.
    expect(wordCalls.map((call) => (call.payload as Array<{ id: string }>).map((row) => row.id)).slice(0, 3)).toEqual([["w-local", "w-ok"], ["w-local"], ["w-ok"]]);
    // Later rounds (setUser and syncNow each ran one) retry only the refused row: w-ok is settled.
    expect(wordCalls.slice(3).every((call) => (call.payload as Array<{ id: string }>).every((row) => row.id === "w-local"))).toBe(true);
    expect(net.calls.some((call) => call.kind === "upsert" && call.table === "eng_activity")).toBe(true);
    expect(engine.getState().status).toBe("error");
    expect(engine.getState().lastError).toContain("duplicate key");
    expect(engine.getState().pendingCount).toBe(1);
  });

  it("does not push rows it pulled in an earlier session (echoes survive a restart)", async () => {
    const storage = new Map<string, string>();
    const shared = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
    const server = { eng_books: [{ id: "b9", title: "t", short_name: "RW2", unit: 50, page: 1, updated_at: iso(300), deleted_at: null }] };
    const repo = fakeRepo();
    const net = fakeClient(server);
    const make = () =>
      createSyncEngine({ repo: repo.repo, client: net.client, now: () => new Date(T0 + 60_000), storage: shared, isOnline: () => true });
    const first = make();
    first.setUser("u1");
    await first.syncNow();
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(0);

    // "Restart": a new engine on the same storage and the same local rows.
    const second = make();
    second.setUser("u1");
    await second.syncNow();
    expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(0);
    expect(second.getState().pendingCount).toBe(0);
  });

  it("a server clock ahead of the device does not hide new local rows (push cursor)", async () => {
    // The server stamps "iso(300)", the device clock says iso(60). Following the echo would put
    // the cursor at iso(300) and the activity written at iso(61) would never be sent.
    const server = { eng_books: [{ id: "b9", title: "t", short_name: "RW2", unit: 1, page: 1, updated_at: iso(300), deleted_at: null }] };
    let nowSeconds = 60;
    const { repo, net, engine } = setup({ server, clock: () => new Date(T0 + nowSeconds * 1000) });
    engine.setUser("u1");
    await engine.syncNow();

    nowSeconds = 61;
    repo.rows.get("activity")!.push({ id: "a2", block: "okuma", startedAt: iso(61), seconds: 60, source: "timer", updatedAt: iso(61) });
    nowSeconds = 62;
    await engine.syncNow();
    const sent = net.calls.filter((call) => call.kind === "upsert" && call.table === "eng_activity");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject([{ id: "a2" }]);
  });

  it("pages with a keyset (updated_at, id): no row is lost between pages, equal times are tiebreaked by id", async () => {
    const many = Array.from({ length: 2500 }, (_, index) => ({
      id: `b${String(index).padStart(4, "0")}`,
      title: "t",
      short_name: "RW1",
      unit: 1,
      page: 1,
      // 500 rows share each updated_at, so pages end in the middle of an equal-time group.
      updated_at: new Date(T0 + Math.floor(index / 500) * 1000).toISOString().replace("Z", "123+00:00"),
      deleted_at: null,
    }));
    const { repo, net, engine } = setup({ server: { eng_books: many } });
    engine.setUser("u1");
    await engine.syncNow();
    const ids = repo.applied.filter((entry) => entry.store === "books").flatMap((entry) => (entry.rows as Array<{ id: string }>).map((row) => row.id));
    expect(new Set(ids).size).toBe(2500);
    const pulls = net.calls.filter((call) => call.kind === "select" && call.table === "eng_books").slice(0, 3);
    expect(pulls).toHaveLength(3);
    // Page 2 and 3 use the microsecond time of the last row, written with "Z" (a "+" would turn into a space).
    expect(pulls[1]?.filter).toBe('updated_at.gt.2026-11-17T10:00:01.000123Z,and(updated_at.eq.2026-11-17T10:00:01.000123Z,id.gt."b0999")');
  });

  describe("another account on the same device", () => {
    const sharedStorage = () => {
      const storage = new Map<string, string>();
      return { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
    };
    const make = (repo: ReturnType<typeof fakeRepo>, net: ReturnType<typeof fakeClient>, storage: ReturnType<typeof sharedStorage>) =>
      createSyncEngine({ repo: repo.repo, client: net.client, now: () => new Date(T0 + 60_000), storage, isOnline: () => true });

    it("asks before uploading: nothing is sent until the user answers", async () => {
      const storage = sharedStorage();
      const repo = fakeRepo();
      const net = fakeClient();
      repo.rows.get("books")!.push(book("b1", iso(1)));
      const first = make(repo, net, storage);
      first.setUser("u1");
      await first.syncNow();
      first.setUser(null);
      net.calls.length = 0;

      const second = make(repo, net, storage);
      second.setUser("u2");
      await second.syncNow();
      expect(second.getState()).toMatchObject({ status: "disabled", foreignData: true });
      expect(net.calls).toHaveLength(0);
    });

    it('"keep" starts from the beginning and uploads the local data to the new account', async () => {
      const storage = sharedStorage();
      const repo = fakeRepo();
      const net = fakeClient();
      repo.rows.get("books")!.push(book("b1", iso(1)));
      const first = make(repo, net, storage);
      first.setUser("u1");
      await first.syncNow();
      first.setUser(null);
      net.calls.length = 0;

      const second = make(repo, net, storage);
      second.setUser("u2");
      await second.confirmUserSwitch("keep");
      expect(repo.clearedCount()).toBe(0);
      expect(net.calls.some((call) => call.kind === "upsert" && call.table === "eng_books")).toBe(true);
      expect(second.getState()).toMatchObject({ foreignData: false, status: "idle" });
    });

    it('"clear" deletes the local data first, then downloads the new account\'s data', async () => {
      const storage = sharedStorage();
      const repo = fakeRepo();
      const net = fakeClient({ eng_books: [{ id: "bx", title: "t", short_name: "RW2", unit: 1, page: 1, updated_at: iso(5), deleted_at: null }] });
      repo.rows.get("words")!.push(wordRow("w-old", "secret", iso(1)));
      const first = make(repo, net, storage);
      first.setUser("u1");
      await first.syncNow();
      first.setUser(null);
      net.calls.length = 0;

      const second = make(repo, net, storage);
      second.setUser("u2");
      await second.confirmUserSwitch("clear");
      expect(repo.clearedCount()).toBe(1);
      expect(net.calls.filter((call) => call.kind === "upsert")).toHaveLength(0);
      expect(repo.rows.get("words")).toHaveLength(0);
      // Pull cursors were reset, so the new account's old rows come down.
      expect(net.calls.find((call) => call.kind === "select" && call.table === "eng_books")?.since).toBe("1970-01-01T00:00:00.000Z");
    });

    it("the same account signing in again is not asked anything", async () => {
      const storage = sharedStorage();
      const repo = fakeRepo();
      const net = fakeClient();
      const first = make(repo, net, storage);
      first.setUser("u1");
      await first.syncNow();
      first.setUser(null);
      const again = make(repo, net, storage);
      again.setUser("u1");
      await again.syncNow();
      expect(again.getState().foreignData).toBeFalsy();
      expect(again.getState().status).toBe("idle");
    });
  });
});
