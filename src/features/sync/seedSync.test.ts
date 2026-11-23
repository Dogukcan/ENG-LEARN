// Two real repositories (fake-indexeddb) and one fake server that behaves like the migrations:
// the server stamps updated_at itself and refuses an edit whose client_updated_at is older than
// the row it holds. Proves that a fresh device cannot overwrite real progress with its seed rows.

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createIndexedDbRepository } from "../../data/indexeddb";
import { createSyncEngine } from "./engine";
import type { SyncClient } from "./engine";

type Row = Record<string, unknown>;

function fakeServer() {
  const tables = new Map<string, Map<string, Row>>();
  let lastStamp = 0;
  /** Strictly increasing server clock, so two writes never share a stamp. */
  const stamp = (): string => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString();
  };
  const tableOf = (name: string): Map<string, Row> => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const client: SyncClient = {
    from(name: string) {
      const table = tableOf(name);
      return {
        upsert: async (rows: Row[]) => {
          for (const row of rows) {
            const old = table.get(String(row.id));
            // Same rule as eng_set_updated_at(): a stale edit leaves the row untouched.
            if (old && row.client_updated_at && String(row.client_updated_at) < String(old.updated_at)) continue;
            table.set(String(row.id), { ...row, updated_at: stamp() });
          }
          return { error: null };
        },
        select() {
          let predicate: (row: Row) => boolean = () => true;
          const query = {
            gt(_column: string, value: string) {
              predicate = (row) => String(row.updated_at) > value;
              return query;
            },
            eq(column: string, value: string) {
              predicate = (row) => row[column] === value;
              return query;
            },
            or(filter: string) {
              const match = /^updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\."(.*)"\)$/.exec(filter);
              if (!match) throw new Error(`unexpected filter ${filter}`);
              const time = Date.parse(match[1]!);
              predicate = (row) => {
                const at = Date.parse(String(row.updated_at));
                return at > time || (at === time && String(row.id) > match[3]!);
              };
              return query;
            },
            order: () => query,
            range: () => query,
            then(resolve: (value: { data: Row[]; error: null }) => unknown) {
              const data = [...table.values()]
                .filter(predicate)
                .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || String(a.id).localeCompare(String(b.id)));
              return Promise.resolve(resolve({ data, error: null }));
            },
          };
          return query as never;
        },
      };
    },
  };
  return { client, tables, tableOf };
}

function device(client: SyncClient) {
  const repo = createIndexedDbRepository(`eng-learn-seedsync-${crypto.randomUUID()}`);
  const engine = createSyncEngine({ repo, client, now: () => new Date(), storage: null, isOnline: () => true });
  engine.setUser("user-1");
  return { repo, engine };
}

describe("seed books and sync", () => {
  it("a fresh second device keeps the real progress of the first device", async () => {
    const server = fakeServer();
    const a = device(server.client);
    const rw1 = (await a.repo.books.list()).find((book) => book.shortName === "RW1")!;
    await a.repo.books.setPosition(rw1.id, { unit: 3, page: 9 });
    await a.engine.syncNow();
    expect(server.tableOf("eng_books").get(rw1.id)).toMatchObject({ unit: 3, page: 9 });

    // Device B is brand new: only seed rows, nothing real to send.
    const b = device(server.client);
    expect(await b.repo.sync.listChangedSince("books", "1970-01-01T00:00:00.000Z")).toEqual([]);
    await b.engine.syncNow();
    await a.engine.syncNow();

    expect(server.tableOf("eng_books").get(rw1.id)).toMatchObject({ unit: 3, page: 9 });
    expect(await a.repo.books.get(rw1.id)).toMatchObject({ unit: 3, page: 9 });
    expect(await b.repo.books.get(rw1.id)).toMatchObject({ unit: 3, page: 9 });
  });

  it("clearLocalData brings back seed rows that are older than any real edit", async () => {
    const repo = createIndexedDbRepository(`eng-learn-seedsync-${crypto.randomUUID()}`);
    const [first] = await repo.books.list();
    await repo.books.setPosition(first!.id, { unit: 2, page: 5 });
    await repo.sync.clearLocalData();
    const books = await repo.books.list();
    expect(books.map((book) => [book.unit, book.page, book.updatedAt])).toEqual([
      [1, 1, "1970-01-01T00:00:00.000Z"],
      [1, 1, "1970-01-01T00:00:00.000Z"],
    ]);
  });
});
