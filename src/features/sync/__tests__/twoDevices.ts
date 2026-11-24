import { vi } from "vitest";
import { createIndexedDbRepository } from "../../../data/indexeddb";
import { createSyncEngine } from "../engine";
import type { SyncClient, SyncStorage } from "../engine";
import { TABLES, UNIQUE_COLUMNS } from "../mapping";

type Row = Record<string, unknown>;
type QueryError = { code: string; message: string };
type Result = { error: QueryError | null };
type WriteOperation = "insert" | "update" | "upsert";

const FSRS_FIELDS = ["stability", "stability_fast", "difficulty", "state", "schedule_status", "due_at", "last_review_at", "reps", "scheduled_days", "learning_step", "lapses", "leech"];

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
  const controls: {
    functionMissing: "PGRST202" | "42883" | null;
    loseNextResponse: boolean;
    beforeRpcReply?: () => Promise<void>;
    rpcError?: QueryError;
    malformedReply?: boolean;
  } = { functionMissing: null, loseNextResponse: false };
  const redirectFor = (id: unknown) => [...tableOf("eng_card_redirects").values()]
    .find((row) => row.user_id === USER_ID && row.from_id === id)?.to_id;

  let bundle = false;
  let validateBundleRows = false;

  function write(name: string, rows: Row[], operation: WriteOperation = "update", transactionAt?: string): Result {
    const upsert = operation === "upsert";
    // One statement shares one server timestamp, even when it writes several rows.
    const at = transactionAt ?? new Date(clock).toISOString();
    if (!transactionAt) clock += 1;
    if (upsert && new Set(rows.map((row) => row.id)).size !== rows.length) {
      return { error: { code: "21000", message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
    }
    // A failed chunk must leave every row untouched, including rows before the conflict.
    const next = new Map(tableOf(name));
    for (const input of rows) {
      if (validateBundleRows && (name === "eng_cards" || name === "eng_review_logs")) {
        const required = name === "eng_cards"
          ? ["id", "word_id", ...FSRS_FIELDS.filter((key) => key !== "last_review_at"), "created_at"]
          : ["id", "card_id", "grade", "reviewed_at", "revlog", "previous_card"];
        const missing = required.find((key) => input[key] == null);
        if (missing) return { error: { code: "23502", message: `null value in column "${missing}" violates not-null constraint` } };
        if ((name === "eng_cards" && (![0, 1, 2, 3].includes(Number(input.state)) || !["new", "learning", "review"].includes(String(input.schedule_status)))) ||
          (name === "eng_review_logs" && !["again", "good"].includes(String(input.grade)))) {
          return { error: { code: "23514", message: "check constraint violated" } };
        }
      }
      const old = next.get(String(input.id));
      let row: Row = { ...old, ...structuredClone(input), user_id: input.user_id ?? old?.user_id ?? USER_ID };
      if (row.user_id !== USER_ID || (old && old.user_id !== USER_ID)) {
        return { error: { code: "42501", message: "new row violates row-level security policy" } };
      }
      // Migration 0003 compares against OLD.updated_at, not OLD.client_updated_at. RETURN OLD
      // silently accepts the request without changing the stored row or its timestamp.
      if (operation !== "update" && name === "eng_cards" && redirectFor(row.id)) {
        return { error: { code: "23505", message: "Card id has a canonical redirect" } };
      }
      if (operation === "insert" && old) {
        return { error: { code: "23505", message: `duplicate key value violates primary key on ${name}` } };
      }
      if (old && row.client_updated_at != null && Date.parse(String(row.client_updated_at)) < Date.parse(String(old.updated_at))) {
        row = { ...old }; // set_updated_at runs first and returns OLD.
      } else row.updated_at = at;
      const softDelete = old && old.deleted_at == null && row.deleted_at != null;
      if (name === "eng_cards" && old && !softDelete && Number(row.reps) < Number(old.reps) && !bundle) {
        row = { ...row, ...Object.fromEntries(FSRS_FIELDS.map((key) => [key, old[key]])), updated_at: at };
      }
      if (name === "eng_review_logs") {
        row.card_id = redirectFor(row.card_id) ?? row.card_id;
        // INSERT or UPDATE, after set_updated_at and redirect: old-client fallback.
        if (!bundle && row.deleted_at != null) {
          const card = tableOf("eng_cards").get(String(row.card_id));
          if (card && card.user_id === row.user_id && card.deleted_at == null) {
            row.deleted_at = null;
            row.updated_at = at;
          }
        }
      }
      const column = uniqueColumns.get(name);
      if (column && row.deleted_at == null && row[column] != null && [...next.values()].some((other) =>
        other.id !== row.id && other.user_id === row.user_id && other.deleted_at == null && other[column] === row[column],
      )) {
        return { error: { code: "23505", message: `duplicate key value violates unique constraint on ${name} (user_id, ${column})` } };
      }
      next.set(String(row.id), row);
    }
    tables.set(name, next);
    return { error: null };
  }

  const client = {
    async rpc(_name: "eng_merge_card" | "eng_push_card_bundle", args: { p_card: Row | null; p_logs?: Row[] }) {
      const input = args.p_card!;
      if (controls.functionMissing) return { data: null, error: { code: controls.functionMissing, message: "function missing" } };
      if (controls.rpcError) return { data: null, error: controls.rpcError };
      const at = new Date(clock++).toISOString();
      const snapshot = structuredClone(tables);
      const mutate = (name: string, rows: Row[], operation: WriteOperation = "update") => {
        const result = write(name, rows, operation, at);
        if (result.error) throw result.error;
      };
      let data: Row;
      try {
        if (_name === "eng_push_card_bundle") {
          const logs = args.p_logs ?? [];
          const id = String(input?.id ?? logs[0]?.card_id);
          if (redirectFor(id) || (input && [...tableOf("eng_cards").values()].some((c) =>
            c.user_id === USER_ID && c.id !== id && c.word_id === input.word_id && c.deleted_at == null))) {
            // No changes until the client uses the existing merge path.
            return { data: { status: "merge" }, error: null };
          }
          const old = tableOf("eng_cards").get(id);
          bundle = true;
          validateBundleRows = true;
          for (const log of logs) {
            if (log.card_id !== id) throw { code: "P0001", message: "Mixed card bundle" };
            if (log.deleted_at == null) {
              const serverLog = tableOf("eng_review_logs").get(String(log.id));
              if (serverLog?.deleted_at != null) continue;
              mutate("eng_review_logs", [{ ...log, user_id: USER_ID, client_updated_at: null }], "upsert");
            }
          }
          // Server copies win; add only bundle history absent from the server.
          const history = new Map([...tableOf("eng_review_logs").values()]
            .filter((l) => l.user_id === USER_ID && l.card_id === id).map((l) => [String(l.id), l]));
          for (const log of logs) if (!history.has(String(log.id))) history.set(String(log.id), log);
          const tombstones = new Set(logs.filter((l) => l.deleted_at != null).map((l) => String(l.id)));
          const bundled = new Set(logs.map((l) => String(l.id)));
          const sameTime = (a: unknown, b: unknown) => a == null || b == null
            ? a == null && b == null : Date.parse(String(a)) === Date.parse(String(b));
          // All walks use the same producing-log identity, never a count of children.
          const back = (reps: number, last: unknown) => reps > 0 && last != null
            ? [...history.values()].find((l) => sameTime(last, l.reviewed_at) &&
              Number((l.previous_card as Row)?.reps) + 1 === reps) : undefined;
          if (input) {
            const ancestors: { reps: number; last: unknown; snapshot?: Row }[] = [];
            let reps = Number(old?.reps ?? 0);
            let last: unknown = old?.last_review_at ?? null;
            let snapshot: Row | undefined;
            for (let step = 0; step < history.size + 1; step++) {
              ancestors.push({ reps, last, snapshot });
              const log = back(reps, last);
              if (!log || !tombstones.has(String(log.id))) break;
              snapshot = log.previous_card as Row;
              reps = Number(snapshot.reps); last = snapshot.lastReviewAt ?? null;
            }
            reps = Number(input.reps); last = input.last_review_at;
            snapshot = undefined;
            let reached = false;
            for (let step = 0; step < history.size + 1; step++) {
              const ancestor = ancestors.find((state) => state.reps === reps && sameTime(state.last, last));
              if (ancestor) {
                reached = true;
                // Only a pure undo takes FSRS from the OLD chain's server snapshot.
                if (reps === Number(input.reps) && sameTime(last, input.last_review_at)) {
                  snapshot = ancestor.snapshot;
                }
                break;
              }
              const log = back(reps, last);
              if (!log || log.deleted_at != null || tombstones.has(String(log.id))) break;
              const previous = log.previous_card as Row;
              reps = Number(previous.reps); last = previous.lastReviewAt ?? null;
            }
            let next = { ...input, user_id: USER_ID, client_updated_at: null };
            if (old?.deleted_at == null && old && input.deleted_at != null) {
              // Structural soft deletion always passes.
            } else if (reached && snapshot) {
              next = { ...next, ...Object.fromEntries(FSRS_FIELDS.map((key) =>
                [key, snapshot[key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] ?? null])) };
            } else if (!reached && old) {
              next = { ...next, ...Object.fromEntries(FSRS_FIELDS.map((key) => [key, old[key]])) };
            }
            // First sight has no existing FSRS to protect if the walk cannot reach NEW.
            mutate("eng_cards", [next], "upsert");
          }
          const card = tableOf("eng_cards").get(id);
          const counted = new Set<string>();
          let reps = Number(card?.reps ?? 0);
          let last = card?.last_review_at;
          for (let step = 0; reps > 0 && step < history.size + 1; step++) {
            const log = back(reps, last);
            if (!log || (log.deleted_at != null && !bundled.has(String(log.id))) || counted.has(String(log.id))) break;
            counted.add(String(log.id));
            const previous = log.previous_card as Row;
            reps = Number(previous.reps); last = previous.lastReviewAt;
          }
          for (const item of logs.filter((l) => l.deleted_at != null)) {
            const serverLog = tableOf("eng_review_logs").get(String(item.id));
            const log = serverLog ?? item;
            mutate("eng_review_logs", [{ ...log, user_id: USER_ID, client_updated_at: null,
              deleted_at: serverLog?.deleted_at ?? (!card || card.deleted_at != null || !counted.has(String(log.id))
                ? item.deleted_at : null) }], "upsert");
          }
          data = { status: "ok", card: structuredClone(card ?? null),
            logs: logs.map((l) => structuredClone(tableOf("eng_review_logs").get(String(l.id)))) };
        } else {
        const from = String(input.id);
        const target = redirectFor(from);
        let card = target ? tableOf("eng_cards").get(String(target)) : [...tableOf("eng_cards").values()]
          .find((row) => row.user_id === USER_ID && row.word_id === input.word_id && row.deleted_at == null);
        let selected = false;
        if (target && !card) throw { code: "P0002", message: "redirect target missing" };
        if (!card) {
          // SQL takes explicit fields; ownership and server timestamps never come from p_card.
          const fields = [...TABLES.cards.fields, ...TABLES.cards.nullable].map((key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
          const inserted = Object.fromEntries(fields.map((key) => [key, input[key]]));
          const result = write("eng_cards", [{ ...inserted, id: from, user_id: USER_ID,
            deleted_at: input.deleted_at ?? null, client_updated_at: input.client_updated_at }], "insert", at);
          if (result.error) {
            card = [...tableOf("eng_cards").values()].find((row) => row.user_id === USER_ID && row.word_id === input.word_id && row.deleted_at == null);
            if (!card) throw { code: "P0001", message: "eng_merge_card: card id exists as a tombstone" };
          } else {
            card = tableOf("eng_cards").get(from)!;
            selected = true;
          }
        }
        if (card.id !== from && card.deleted_at == null) {
          const loser = tableOf("eng_cards").get(from);
          if (loser && loser.deleted_at == null) mutate("eng_cards", [{ ...loser, deleted_at: at, client_updated_at: null }]);
          if (Number(input.reps) > Number(card.reps)) {
            mutate("eng_cards", [{ ...card, ...Object.fromEntries(FSRS_FIELDS.map((key) => [key, input[key]])), client_updated_at: null }]);
            card = tableOf("eng_cards").get(String(card.id))!;
            selected = true;
          }
          const previous = tableOf("eng_card_redirects").get(from);
          mutate("eng_card_redirects", [{ ...previous, id: from, from_id: from, to_id: card.id,
            created_at: previous?.created_at ?? at, client_updated_at: null }], "upsert");
          mutate("eng_card_redirects", [...tableOf("eng_card_redirects").values()]
            .filter((redirect) => redirect.user_id === USER_ID && redirect.to_id === from)
            .map((redirect) => ({ ...redirect, to_id: card!.id, client_updated_at: null })));
          bundle = true; // Internal merge move preserves each tombstone exactly.
          mutate("eng_review_logs", [...tableOf("eng_review_logs").values()]
            .filter((log) => log.user_id === USER_ID && log.card_id === from)
            .map((log) => ({ ...log, card_id: card!.id, client_updated_at: null })));
        }
        data = { canonical_id: card.id, selected, card: structuredClone(card) };
        }
      } catch (error) {
        tables.clear();
        for (const [name, rows] of snapshot) tables.set(name, rows);
        return { data: null, error: error as QueryError };
      }
      finally { bundle = false; validateBundleRows = false; }
      await controls.beforeRpcReply?.();
      if (controls.loseNextResponse) {
        controls.loseNextResponse = false;
        return { data: null, error: { code: "", message: "Failed to fetch: lost RPC response" } };
      }
      return { data: controls.malformedReply ? { ...data, card: {} } : data, error: null };
    },
    from(name: string) {
      return {
        upsert: async (rows: Row[], options: { onConflict: string }) => {
          if (options.onConflict !== "id") throw new Error(`unexpected conflict target ${options.onConflict}`);
          return write(name, rows, "upsert");
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
    client, tableOf, controls,
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
