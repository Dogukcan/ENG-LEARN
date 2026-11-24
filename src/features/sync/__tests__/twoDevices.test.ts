import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TABLES, fromRemoteRow, toRemoteRow } from "../mapping";
import type { Card } from "../../../data/types";
import { LOCAL_TIME, USER_ID, createDevice, createSharedServer, createTwoDevices, syncRound } from "./twoDevices";

const EPOCH = "1970-01-01T00:00:00.000Z";

type Device = ReturnType<typeof createDevice>;

async function learn(device: Device, lemma: string, reps: number) {
  return device.run(async () => {
    const { repo } = device;
    const added = await repo.inbox.add({ word: lemma, source: { kind: "diger" } });
    if (!added.ok) throw new Error(`add failed: ${added.reason}`);
    const triaged = await repo.words.triage(added.item.id, "learning", device.now());
    if (!triaged.ok) throw new Error(`triage failed: ${triaged.reason}`);
    const card = (await repo.sync.listChangedSince("cards", EPOCH)).find((row) => row.wordId === triaged.word.id)!;
    for (let i = 0; i < reps; i++) {
      const reviewed = await repo.cards.reviewCard(card.id, "good", device.now());
      if (!reviewed.ok) throw new Error("review failed");
      device.advance(100);
      vi.setSystemTime(device.now());
    }
    return { wordId: triaged.word.id, cardId: card.id };
  });
}

async function reviewIds(devices: Device[]) {
  const logs = await Promise.all(devices.map((d) => d.repo.sync.listChangedSince("reviewLogs", EPOCH)));
  return [...new Set(logs.flat().map((log) => log.id))].sort();
}

async function expectConverged(devices: Device[], server: ReturnType<typeof createSharedServer>, cardId: string, logIds: string[], reps?: number, undone: string[] = []) {
  for (const device of devices) {
    expect(device.engine.getState().status).toBe("idle");
    const cards = (await device.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
    expect(cards.map((card) => card.id)).toEqual([cardId]);
    if (reps !== undefined) expect(cards[0]?.reps).toBe(reps);
    const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs.map((log) => log.id).sort()).toEqual(logIds);
    expect(logs.every((log) => Boolean(log.deletedAt) === undone.includes(log.id) && log.cardId === cardId)).toBe(true);
  }
  const cards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
  expect(cards.map((card) => card.id)).toEqual([cardId]);
  if (reps !== undefined) expect(cards[0]?.reps).toBe(reps);
  const logs = [...server.tableOf("eng_review_logs").values()];
  expect(logs.map((log) => log.id).sort()).toEqual(logIds);
  expect(logs.every((log) => (log.deleted_at != null) === undone.includes(String(log.id)) && log.card_id === cardId)).toBe(true);
}

async function reviewMore(device: Device, cardId: string, count: number) {
  await device.run(async () => {
    for (let i = 0; i < count; i++) {
      expect((await device.repo.cards.reviewCard(cardId, "good", device.now())).ok).toBe(true);
      device.advance(100);
      vi.setSystemTime(device.now());
    }
  });
}

beforeEach(() => {
  // Repository writes use Date directly. Keep those writes and both engine clocks deterministic.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LOCAL_TIME);
});
afterEach(() => vi.useRealTimers());

// Assert convergence, then run the two additional quiet rounds required by round 9c.
async function expectSnapshotConverged(devices: Device[], server: ReturnType<typeof createSharedServer>,
  cardId: string, logIds: string[], reps: number, undone: string[] = [], countMatches = true) {
  const check = async () => {
    await expectConverged(devices, server, cardId, logIds, reps, undone);
    for (const device of devices) {
      expect(device.engine.getState().pendingCount).toBe(0);
      if (countMatches) {
        const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
        expect(logs.filter((log) => !log.deletedAt)).toHaveLength(reps);
      }
    }
    if (countMatches) expect([...server.tableOf("eng_review_logs").values()].filter((log) => log.deleted_at == null)).toHaveLength(reps);
  };
  for (let round = 0; round < 3; round++) for (const device of devices) await syncRound(device);
  await check();
  for (let round = 0; round < 2; round++) for (const device of devices) await syncRound(device);
  await check();
}

describe("round 9d card bundles", () => {
  it.each(["PGRST202", "42883"] as const)("missing bundle %s uses the per-table path for the whole round", async (code) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "legacy", 3);
    const rpc = server.client.rpc.bind(server.client);
    const calls: string[] = [];
    const spy = vi.spyOn(server.client, "rpc").mockImplementation(async (name, args) => {
      calls.push(name);
      return name === "eng_push_card_bundle" ? { data: null, error: { code, message: "function missing" } } : rpc(name, args);
    });
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), 3);
    expect(calls).toEqual(["eng_push_card_bundle"]);
    spy.mockRestore();
  });

  it("retries a committed bundle after its response is lost without duplicate logs", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "retry", 3);
    const ids = await reviewIds([a]);
    server.controls.loseNextResponse = true;
    await expect(syncRound(a)).rejects.toThrow("lost RPC response");
    expect(a.engine.getState().status).toBe("offline");
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
    expect(server.tableOf("eng_review_logs").size).toBe(3);
    await expectSnapshotConverged([a, b], server, first.cardId, ids, 3);
  });

  it.each([false, true])("retries accepted undo without reviving its log (re-rate %s)", async (rerate) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "retry-undo", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    const logs = await a.repo.sync.listChangedSince("reviewLogs", EPOCH);
    const undone = logs.filter((r) => r.deletedAt).map((r) => r.id);
    if (rerate) await reviewMore(a, first.cardId, 1);
    server.controls.loseNextResponse = true;
    await expect(syncRound(a)).rejects.toThrow("lost RPC response");
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(rerate ? 3 : 2);
    expect(undone).toHaveLength(1);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), rerate ? 3 : 2, undone);
  });

  it.each([1, 3])("logs-only tombstone accepts the exact parent state using the server snapshot (%i reviews)", async (reps) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "parent-state", reps);
    await syncRound(a);
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    await syncRound(a);
    const log = [...server.tableOf("eng_review_logs").values()].find((l) => l.deleted_at != null)!;
    // Model a live log left at the parent card state, without changing the card.
    await server.client.from("eng_review_logs").update({ deleted_at: null, client_updated_at: null }).eq("id", String(log.id));
    const previous = structuredClone(log.previous_card) as Record<string, unknown>;
    if (previous.lastReviewAt) previous.lastReviewAt = String(previous.lastReviewAt).replace("Z", "+00:00");
    await server.client.from("eng_review_logs").update({ previous_card: previous, client_updated_at: null }).eq("id", String(log.id));
    const result = await server.client.rpc("eng_push_card_bundle", { p_card: null, p_logs: [{ ...log,
      deleted_at: server.now().toISOString(), previous_card: { ...previous, reps: 999, lastReviewAt: EPOCH } }] });
    expect(result.error).toBeNull();
    expect(server.tableOf("eng_review_logs").get(String(log.id))?.deleted_at).toBeTruthy();
    expect(server.tableOf("eng_review_logs").get(String(log.id))?.previous_card).toEqual(previous);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), reps - 1, [String(log.id)]);
  });

  it.each([-1000, 0, 1000])("pull preserves pending cards and logs for timestamp delta %i", async (delta) => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    const first = await learn(a, "pending-order", 1);
    await syncRound(a);
    await syncRound(b);
    await reviewMore(a, first.cardId, 1);
    for (const store of ["cards", "reviewLogs"] as const) {
      const locals = await a.repo.sync.listChangedSince(store, EPOCH);
      const row = locals.at(-1)!;
      const pulled = { ...row, updatedAt: new Date(Date.parse(row.updatedAt) + delta).toISOString(),
        ...(store === "cards" ? { reps: 99 } : { deletedAt: EPOCH }) };
      expect(await a.repo.sync.applyRemote(store, [pulled], (local) => local.id === row.id))
        .toMatchObject({ applied: 0, skipped: 1 });
      expect((await a.repo.sync.listChangedSince(store, EPOCH)).find((r) => r.id === row.id)).toEqual(row);
    }
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), 2);
  });

  it("bundle failure rolls back live logs as well as the card", async () => {
    const { a, server } = createTwoDevices();
    const first = await learn(a, "atomic", 1);
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const log = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH))[0]!;
    const result = await server.client.rpc("eng_push_card_bundle", { p_card: toRemoteRow("cards", card),
      p_logs: [toRemoteRow("reviewLogs", log), { ...toRemoteRow("reviewLogs", log), id: "wrong", card_id: "other" }] });
    expect(result.error).not.toBeNull();
    expect(server.tableOf("eng_cards").has(first.cardId)).toBe(false);
    expect(server.tableOf("eng_review_logs").size).toBe(0);
    // A failure must also clear the fake's transaction-local bundle flag.
    await server.client.from("eng_cards").upsert([toRemoteRow("cards", card)], { onConflict: "id" });
    await server.client.from("eng_review_logs").upsert([{ ...toRemoteRow("reviewLogs", log), deleted_at: server.now().toISOString() }], { onConflict: "id" });
    expect(server.tableOf("eng_review_logs").get(log.id)?.deleted_at).toBeNull();
  });

  it("bundle rejects incomplete rows and resets its flag after an error", async () => {
    const server = createSharedServer();
    expect(await server.client.rpc("eng_push_card_bundle", { p_card: { id: "bad", word_id: "word", reps: 1 }, p_logs: [] }))
      .toMatchObject({ data: null, error: { code: "23502" } });
    expect(server.tableOf("eng_cards").size).toBe(0);
  });

  it("matching walked state accepts incoming FSRS and non-review metadata", async () => {
    const { a, server } = createTwoDevices();
    const first = await learn(a, "metadata", 2);
    await syncRound(a);
    const old = structuredClone(server.tableOf("eng_cards").get(first.cardId))!;
    const result = await server.client.rpc("eng_push_card_bundle", { p_card: { ...old, word_id: "repointed", stability: 999, leech: true }, p_logs: [] });
    expect(result.error).toBeNull();
    const card = server.tableOf("eng_cards").get(first.cardId)!;
    expect(card).toMatchObject({ word_id: "repointed", stability: 999, leech: true, reps: 2 });
    expect(card.updated_at).not.toBe(old.updated_at);
  });

  it("logs-only bundle keeps card FSRS and refuses an unaccompanied tombstone", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "logs", 2);
    await syncRound(a);
    const card = structuredClone(server.tableOf("eng_cards").get(first.cardId));
    const log = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH))[1]!;
    const result = await server.client.rpc("eng_push_card_bundle", { p_card: null,
      p_logs: [{ ...toRemoteRow("reviewLogs", log), deleted_at: server.now().toISOString() }] });
    expect(result.error).toBeNull();
    expect(server.tableOf("eng_cards").get(first.cardId)).toEqual(card);
    expect(server.tableOf("eng_review_logs").get(log.id)?.deleted_at).toBeNull();
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), 2);
  });

  it("undo restores the server snapshot rather than forged incoming FSRS", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "snapshot", 3);
    await syncRound(a);
    const latest = [...server.tableOf("eng_review_logs").values()].find((l) => l.reviewed_at === server.tableOf("eng_cards").get(first.cardId)?.last_review_at)!;
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    const rpc = server.client.rpc.bind(server.client);
    const spy = vi.spyOn(server.client, "rpc").mockImplementationOnce((name, args) => rpc(name, {
      ...args, p_card: { ...args.p_card!, stability: 999, due_at: EPOCH },
      p_logs: args.p_logs?.map((l) => ({ ...l, previous_card: { ...(l.previous_card as Record<string, unknown>), stability: 888 } })),
    }));
    await syncRound(a);
    spy.mockRestore();
    expect(server.tableOf("eng_cards").get(first.cardId)?.stability).toBe((latest.previous_card as Record<string, unknown>).stability);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), 2, [String(latest.id)]);
  });

  it("bundle normalization preserves a pending undo behind server time through the unchanged pull path", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "pending", 1);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    a.advance(-5000);
    await reviewMore(a, first.cardId, 1);
    const ids = await reviewIds([a]);
    const from = server.client.from.bind(server.client);
    let undone = false;
    const spy = vi.spyOn(server.client, "from").mockImplementation((table) => {
      const query = from(table);
      if (table === "eng_cards") {
        const select = query.select.bind(query);
        query.select = (columns) => {
          const selection = select(columns);
          const then = selection.then.bind(selection);
          selection.then = async (resolve, reject) => {
            if (!undone) {
              undone = true;
              expect((await a.repo.cards.undoLastReview()).ok).toBe(true);
            }
            return then(resolve, reject);
          };
          return selection;
        };
      }
      return query;
    });
    try { await syncRound(a); } finally { spy.mockRestore(); }
    expect(undone).toBe(true);
    // The bundle first installs the server stamp; undo's stampFrom is newer even with skew.
    expect((await a.repo.sync.listChangedSince("cards", EPOCH))[0]?.reps).toBe(1);
    const undoneIds = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((r) => r.deletedAt).map((r) => r.id);
    await expectSnapshotConverged([a, b], server, first.cardId, ids, 1, undoneIds);
  });

  it("preserves pending undo during a negative-skew bundle request", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "inflight", 1);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    a.advance(-5000);
    await reviewMore(a, first.cardId, 1);
    const ids = await reviewIds([a]);
    server.controls.beforeRpcReply = async () => {
      server.controls.beforeRpcReply = undefined;
      expect((await a.repo.cards.undoLastReview()).ok).toBe(true);
    };
    await syncRound(a);
    expect((await a.repo.sync.listChangedSince("cards", EPOCH))[0]?.reps).toBe(1);
    const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((r) => r.deletedAt).map((r) => r.id);
    expect(undone).toHaveLength(1);
    await expectSnapshotConverged([a, b], server, first.cardId, ids, 1, undone);
  });

  it("keeps a deleted canonical card deleted after an in-flight review", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: 5000 });
    const first = await learn(a, "deleted-merge", 1);
    await syncRound(a);
    const second = await learn(b, "Deleted-merge", 3);
    // Commit the redirect without applying its reply to B, then delete its target.
    const local = (await b.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    await server.client.rpc("eng_merge_card", { p_card: { ...toRemoteRow("cards", local), word_id: first.wordId } });
    for (const [table, id] of [["eng_cards", first.cardId], ["eng_words", first.wordId]]) {
      await server.client.from(table!).update({ deleted_at: server.now().toISOString(), client_updated_at: null }).eq("id", id!);
    }
    let edited = false;
    const rpc = server.client.rpc.bind(server.client);
    const spy = vi.spyOn(server.client, "rpc").mockImplementation(async (name, args) => {
      if (name === "eng_merge_card" && !edited) {
        edited = true;
        server.controls.beforeRpcReply = async () => {
          server.controls.beforeRpcReply = undefined;
          await reviewMore(b, second.cardId, 1);
        };
      }
      return rpc(name, args);
    });
    try { await syncRound(b); } finally { spy.mockRestore(); }
    expect(edited).toBe(true);
    expect((await b.repo.sync.listChangedSince("cards", EPOCH))[0]?.deletedAt).toBeTruthy();
    const ids = await reviewIds([a, b]);
    const check = async () => {
      for (const device of [a, b]) {
        const cards = await device.repo.sync.listChangedSince("cards", EPOCH);
        expect(cards).toHaveLength(1);
        expect(cards[0]).toMatchObject({ id: first.cardId, reps: 3, deletedAt: expect.any(String) });
        const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
        expect(logs.map((l) => l.id).sort()).toEqual(ids);
        expect(logs.every((l) => l.cardId === first.cardId)).toBe(true);
        expect(device.engine.getState()).toMatchObject({ status: "idle", pendingCount: 0 });
      }
      expect(server.tableOf("eng_cards").get(first.cardId)).toMatchObject({ reps: 3, deleted_at: expect.any(String) });
      expect([...server.tableOf("eng_cards").values()].filter((c) => c.deleted_at == null)).toHaveLength(0);
      expect([...server.tableOf("eng_review_logs").values()].map((l) => l.id).sort()).toEqual(ids);
      expect([...server.tableOf("eng_review_logs").values()].every((l) => l.card_id === first.cardId)).toBe(true);
    };
    for (let i = 0; i < 3; i++) for (const device of [a, b]) await syncRound(device);
    await check();
    for (let i = 0; i < 2; i++) for (const device of [a, b]) await syncRound(device);
    await check();
    expect(server.tableOf("eng_words").get(first.wordId)?.deleted_at).not.toBeNull();
  });

  it.each([-5000, 5000])("undo then re-rate with skew %i keeps exactly the replacement log", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "bundle", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    a.advance(skewMs);
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((r) => r.deletedAt).map((r) => r.id);
    await reviewMore(a, first.cardId, 1);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a]), 3, undone);
  });

  it.each([false, true])("accepts an INSERT tombstone after card-only success / log failure (%s) and offline undo", async (networkFailure) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "bundle", 2);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1);
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    if (networkFailure) {
      const from = server.client.from.bind(server.client);
      const rpc = server.client.rpc.bind(server.client);
      const rpcSpy = vi.spyOn(server.client, "rpc").mockImplementation((name, args) => name === "eng_push_card_bundle"
        ? Promise.resolve({ data: null, error: { code: "PGRST202", message: "function missing" } }) : rpc(name, args));
      const fromSpy = vi.spyOn(server.client, "from").mockImplementation((table) => {
        const query = from(table);
        if (table === "eng_review_logs") query.upsert = async () => ({ error: { code: "", message: "Failed to fetch" } });
        return query;
      });
      try { await expect(syncRound(a)).rejects.toThrow("Failed to fetch"); }
      finally { rpcSpy.mockRestore(); fromSpy.mockRestore(); }
      expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
      expect(server.tableOf("eng_review_logs").size).toBe(2);
    } else {
      expect((await server.client.from("eng_cards").upsert([toRemoteRow("cards", card)], { onConflict: "id" })).error).toBeNull();
    }
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    const logs = await a.repo.sync.listChangedSince("reviewLogs", EPOCH);
    await expectSnapshotConverged([a, b], server, first.cardId, logs.map((r) => r.id).sort(), 2,
      logs.filter((r) => r.deletedAt).map((r) => r.id));
  });
});

describe("round 9c snapshot undo", () => {
  it.each([-5000, 5000])("F5: stale branch with device skew %i preserves server reps", async (skewMs) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const first = await learn(a, "harbor", 1);
    for (const device of [a, b]) await syncRound(device);
    // A's review clock is ahead too: both B skews produce an older review time
    // while B's edit timestamp is fresh enough to reach the reps guard.
    a.advance(30000);
    server.advance(10000);
    await reviewMore(a, first.cardId, 2);
    await syncRound(a);
    const winner = structuredClone(server.tableOf("eng_cards").get(first.cardId))!;
    server.advance(10000);
    await reviewMore(b, first.cardId, 1);
    const logIds = await reviewIds([a, b]);
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(first.cardId)).toMatchObject({ reps: 3, last_review_at: winner.last_review_at });
    // Separate offline branches retain all four logs, although the winning state has three reps.
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 3, [], false);
  });

  it("T2: rejects a shorter review made during the merge RPC", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 3);
    await syncRound(a);
    const second = await learn(b, "Harbor", 1);
    server.controls.beforeRpcReply = async () => {
      server.controls.beforeRpcReply = undefined;
      await reviewMore(b, second.cardId, 1);
    };
    await syncRound(b);
    expect(await b.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ id: first.cardId, reps: 2 }]);
    const logIds = await reviewIds([a, b]);
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 3, [], false);
  });

  it("M1: a stale word-twin re-point preserves word_id but cannot undo", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    await reviewMore(b, first.cardId, 1);
    await syncRound(b);
    server.advance(10000);
    // A remote word twin invokes moveCardAfterWordTwin on A's stale two-rep card.
    const [word] = await a.repo.sync.listChangedSince("words", EPOCH);
    await a.run(() => a.repo.sync.applyRemote("words", [{ ...word, id: "surviving-word", updatedAt: a.now().toISOString() }]));
    expect(await a.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ wordId: "surviving-word", reps: 2 }]);
    const logIds = await reviewIds([a, b]);
    await syncRound(a);
    expect(server.tableOf("eng_cards").get(first.cardId)).toMatchObject({ reps: 3, word_id: "surviving-word" });
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 3);
    for (const device of [a, b]) expect(await device.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ wordId: "surviving-word" }]);
  });

  it("M2: restores a tombstone when the server rejects the stale undo", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    await reviewMore(b, first.cardId, 1);
    await syncRound(b);
    server.advance(10000);
    const logIds = await reviewIds([a, b]);
    expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 1 } });
    await syncRound(a);
    expect([...server.tableOf("eng_review_logs").values()].filter((log) => log.deleted_at == null)).toHaveLength(3);
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 3);
  });

  it.each([-5000, 0, 5000])("normal snapshot undo propagates with device skew %i", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    a.advance(skewMs);
    const logIds = await reviewIds([a, b]);
    const undo = await a.run(() => a.repo.cards.undoLastReview());
    expect(undo).toMatchObject({ ok: true, card: { reps: 1 } });
    const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((log) => log.deletedAt).map((log) => log.id);
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 1, undone);
  });

  it("two undos with a sync between both propagate", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    const logIds = await reviewIds([a, b]);
    for (const reps of [1, 0]) {
      server.advance(10000);
      expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps } });
      const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((log) => log.deletedAt).map((log) => log.id);
      await expectSnapshotConverged([a, b], server, first.cardId, logIds, reps, undone);
    }
  });

  it("two unsynced undos walk back twice and preserve consistency", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: 5000 });
    const first = await learn(a, "harbor", 3);
    for (const device of [a, b]) await syncRound(device);
    const logIds = await reviewIds([a, b]);
    server.advance(10000);
    for (const reps of [2, 1]) expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps } });
    const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((l) => l.deletedAt).map((l) => l.id);
    await syncRound(a);
    expect([...server.tableOf("eng_review_logs").values()].filter((log) => log.deleted_at == null)).toHaveLength(1);
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 1, undone);
  });

  it("word/card deletion allows all review-log tombstones", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    await learn(a, "harbor", 3);
    for (const device of [a, b]) await syncRound(device);
    const logIds = await reviewIds([a, b]);
    server.advance(10000);
    await a.run(async () => {
      for (const store of ["words", "cards", "reviewLogs"] as const) {
        const rows = await a.repo.sync.listChangedSince(store, EPOCH);
        await a.repo.sync.applyRemote(store, rows.map((row) => ({ ...row, updatedAt: a.now().toISOString(), deletedAt: a.now().toISOString() })));
      }
    });
    const check = async () => {
      for (const device of [a, b]) {
        expect(device.engine.getState().pendingCount).toBe(0);
        for (const store of ["words", "cards", "reviewLogs"] as const) expect((await device.repo.sync.listChangedSince(store, EPOCH)).every((row) => row.deletedAt)).toBe(true);
        expect((await device.repo.sync.listChangedSince("reviewLogs", EPOCH)).map((log) => log.id).sort()).toEqual(logIds);
      }
      for (const name of ["eng_words", "eng_cards", "eng_review_logs"]) expect([...server.tableOf(name).values()].every((row) => row.deleted_at != null)).toBe(true);
      expect(server.tableOf("eng_review_logs").size).toBe(3);
    };
    for (let round = 0; round < 3; round++) for (const device of [a, b]) await syncRound(device);
    await check();
    for (let round = 0; round < 2; round++) for (const device of [a, b]) await syncRound(device);
    await check();
  });
});

describe("two devices sharing a Supabase server", () => {
  it.each([0, 5000])("round 9b: stale reps never cancel a word/card soft delete (%i ms)", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    await reviewMore(b, first.cardId, 3);
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(5);
    server.advance(10000);
    a.advance(skewMs);
    await a.run(async () => {
      const [card] = await a.repo.sync.listChangedSince("cards", EPOCH);
      const [word] = await a.repo.words.listByStatus("learning");
      expect(card?.reps).toBe(2);
      const at = a.now().toISOString();
      await a.repo.sync.applyRemote("cards", [{ ...card, updatedAt: at, deletedAt: at }]);
      await a.repo.sync.applyRemote("words", [{ ...word, updatedAt: at, deletedAt: at }]);
    });
    const logIds = await reviewIds([a, b]);
    for (const device of [a, b, a]) await syncRound(device);
    expect([...server.tableOf("eng_cards").values()].filter((card) => card.deleted_at == null)).toEqual([]);
    expect([...server.tableOf("eng_words").values()].filter((word) => word.deleted_at == null)).toEqual([]);
    for (const device of [a, b]) {
      expect(await device.repo.words.listByStatus("learning")).toEqual([]);
      expect((await device.repo.sync.listChangedSince("cards", EPOCH)).filter((card) => !card.deletedAt)).toEqual([]);
      expect((await device.repo.cards.getReviewQueue(new Date("2030-01-01"))).dueTotal).toBe(0);
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs.map((log) => log.id).sort()).toEqual(logIds);
      expect(logs.every((log) => log.cardId === first.cardId)).toBe(true);
    }
    expect([...server.tableOf("eng_review_logs").values()].map((log) => log.id).sort()).toEqual(logIds);
    expect([...server.tableOf("eng_review_logs").values()].every((log) => log.card_id === first.cardId)).toBe(true);
  });

  it.each([0, 5000])("round 9b: a later shorter branch review is not a one-step undo (%i ms)", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 2);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    await reviewMore(b, first.cardId, 2);
    await syncRound(b);
    const winner = structuredClone(server.tableOf("eng_cards").get(first.cardId))!;
    server.advance(10000);
    a.advance(skewMs);
    await reviewMore(a, first.cardId, 1);
    const logIds = await reviewIds([a, b]);
    const [stale] = await a.repo.sync.listChangedSince("cards", EPOCH);
    expect(stale?.reps).toBe(3);
    expect(Date.parse(String(stale?.lastReviewAt))).toBeGreaterThan(Date.parse(String(winner.last_review_at)));
    for (const device of [a, b, a]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 4);
    expect(server.tableOf("eng_cards").get(first.cardId)?.last_review_at).toBe(winner.last_review_at);
  });

  it.each([0, 5000])("round 9b: preserves an undo between card push and pull (%i ms)", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    for (const device of [a, b]) await syncRound(device);
    server.advance(10000);
    a.advance(skewMs);
    await reviewMore(a, first.cardId, 1);
    const logIds = await reviewIds([a, b]);
    const last = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH))
      .sort((x, y) => String(y.reviewedAt).localeCompare(String(x.reviewedAt)))[0]!;
    const originalFrom = server.client.from.bind(server.client);
    let undone = false;
    const spy = vi.spyOn(server.client, "from").mockImplementation((table) => {
      const query = originalFrom(table);
      if (table === "eng_cards") {
        const select = query.select.bind(query);
        query.select = (columns) => {
          const selection = select(columns);
          const then = selection.then.bind(selection);
          selection.then = async (resolve, reject) => {
            if (!undone) {
              undone = true;
              expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(2);
              expect(await a.repo.cards.undoLastReview()).toMatchObject({ ok: true, card: { reps: 1 } });
            }
            return then(resolve, reject);
          };
          return selection;
        };
      }
      return query;
    });
    try { await syncRound(a); } finally { spy.mockRestore(); }
    expect(undone).toBe(true);
    expect((await a.repo.sync.listChangedSince("cards", EPOCH))[0]?.reps).toBe(1);
    expect(a.engine.getState().pendingCount).toBeGreaterThan(0);
    for (const device of [a, b, a]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 1, [last.id]);
    expect(a.engine.getState().pendingCount).toBe(0);
  });

  it("round 9b: tombstone insert race returns P0001 and continues the round", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: 5000 });
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const second = await learn(b, "Harbor", 3);
    const [local] = await b.repo.sync.listChangedSince("cards", EPOCH);
    expect((await server.client.from("eng_cards").upsert([{
      ...toRemoteRow("cards", local!, USER_ID), word_id: first.wordId,
      deleted_at: server.now().toISOString(), client_updated_at: null,
    }], { onConflict: "id" })).error).toBeNull();
    await b.run(() => b.repo.activity.add({ block: "kelime", source: "manual", startedAt: b.now().toISOString(), seconds: 60 }));
    const rpc = server.client.rpc.bind(server.client);
    let result: Awaited<ReturnType<typeof rpc>> | undefined;
    const spy = vi.spyOn(server.client, "rpc").mockImplementation(async (name, args) => {
      if (name === "eng_push_card_bundle") return { data: null, error: { code: "PGRST202", message: "function missing" } };
      expect(args.p_card?.id).toBe(second.cardId);
      expect((await server.client.from("eng_cards").update({
        deleted_at: server.now().toISOString(), client_updated_at: null,
      }).eq("id", first.cardId)).error).toBeNull();
      result = await rpc(name, args);
      return result;
    });
    try { await syncRound(b).catch(() => {}); } finally { spy.mockRestore(); }
    expect(result).toMatchObject({ data: null, error: { code: "P0001", message: "eng_merge_card: card id exists as a tombstone" } });
    expect(b.engine.getState()).toMatchObject({ status: "error", lastError: expect.stringContaining("card id exists as a tombstone") });
    expect(server.tableOf("eng_activity").size).toBe(1);
    expect(server.tableOf("eng_review_logs").size).toBe(4);
    expect(server.tableOf("eng_cards").get(second.cardId)?.deleted_at).not.toBeNull();
    expect([...server.tableOf("eng_cards").values()].filter((card) => card.deleted_at == null)).toEqual([]);
    const pending = (await b.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    expect(pending.id).toBe(second.cardId);
    expect((await b.repo.sync.listChangedSince("cards", b.storage.getItem("eng-learn.sync.push.cards") ?? EPOCH))
      .some((card) => card.id === pending.id)).toBe(true);
    const echoes = JSON.parse(b.storage.getItem("eng-learn.sync.echo.cards") ?? "{}");
    expect(echoes[pending.id]).not.toBe(pending.updatedAt);
  });

  it("copies a word from A to B through a full sync round", async () => {
    const { a, b } = createTwoDevices();
    const word = await learn(a, "harbor", 0);
    await syncRound(a);
    await syncRound(b);
    expect(await b.repo.words.listByStatus("learning")).toMatchObject([{ id: word.wordId, lemma: "harbor" }]);
  });

  it("seed books do not overwrite progress on a fresh second device", async () => {
    const { a, b } = createTwoDevices();
    const rw1 = (await a.repo.books.list()).find((book) => book.shortName === "RW1")!;
    await a.run(() => a.repo.books.setPosition(rw1.id, { unit: 4, page: 37 }));
    await syncRound(a);
    await syncRound(b);
    await syncRound(b);
    await syncRound(a);
    for (const device of [a, b]) expect(await device.repo.books.get(rw1.id)).toMatchObject({ unit: 4, page: 37 });
  });

  it.each([-5000, 0, 5000].flatMap((skewMs) => [
    { name: "higher-reps branch pushes first", aReps: 3, bReps: 1, skewMs },
    { name: "higher-reps branch pushes second", aReps: 1, bReps: 3, skewMs },
    { name: "tie keeps server state", aReps: 1, bReps: 1, skewMs },
  ]))("twin word: $name ($skewMs ms), preserving every review log", async ({ aReps, bReps, skewMs }) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const first = await learn(a, "harbor", aReps);
    await syncRound(a);
    const second = await learn(b, "Harbor", bReps);
    const originalCard = (await (bReps > aReps ? b : a).repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const logIds = await reviewIds([a, b]);
    expect(second.wordId).not.toBe(first.wordId);
    expect(second.cardId).not.toBe(first.cardId);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    const winnerId = first.cardId;
    for (const device of [a, b]) {
      const words = await device.repo.words.listByStatus("learning");
      expect(words).toHaveLength(1);
      expect(words[0]?.id).toBe(first.wordId);
      const cards = (await device.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ ...originalCard, id: winnerId, wordId: first.wordId, updatedAt: expect.any(String), createdAt: expect.any(String) });
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs).toHaveLength(aReps + bReps);
      expect(logs.every((log) => log.cardId === winnerId)).toBe(true);
    }
    const liveServerCards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
    expect(liveServerCards).toMatchObject([{ id: winnerId, reps: Math.max(aReps, bReps) }]);
    await expectConverged([a, b], server, winnerId, logIds, Math.max(aReps, bReps));
  });

  it("keeps a word, its card and all logs intact when there is no twin", async () => {
    const { a, b } = createTwoDevices();
    const original = await learn(a, "harbor", 2);
    const originalLogs = await a.repo.sync.listChangedSince("reviewLogs", EPOCH);
    await syncRound(a);
    await syncRound(b);
    await syncRound(a);
    for (const device of [a, b]) {
      expect(await device.repo.words.listByStatus("learning")).toMatchObject([{ id: original.wordId }]);
      expect(await device.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ id: original.cardId, wordId: original.wordId, reps: 2 }]);
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs.map((log) => log.id).sort()).toEqual(originalLogs.map((log) => log.id).sort());
      expect(logs.every((log) => log.cardId === original.cardId)).toBe(true);
    }
  });

  it.each([
    { aReps: 3, bReps: 1, winner: "a" },
    { aReps: 1, bReps: 3, winner: "b" },
  ] as const)("moves logs when the surviving word's card is already local ($winner wins)", async ({ aReps, bReps, winner }) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", aReps);
    const second = await learn(b, "Harbor", bReps);
    await syncRound(a);
    // A partial download can deliver the surviving word's card and logs before its word.
    await b.run(() => b.repo.sync.applyRemote("cards", [...server.tableOf("eng_cards").values()].map((row) => fromRemoteRow("cards", row))));
    await b.run(() => b.repo.sync.applyRemote("reviewLogs", [...server.tableOf("eng_review_logs").values()].map((row) => fromRemoteRow("reviewLogs", row))));
    const before = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    await b.run(() => b.repo.sync.applyRemote("words", [...server.tableOf("eng_words").values()].map((row) => fromRemoteRow("words", row))));
    const winnerId = winner === "a" ? first.cardId : second.cardId;
    const loserId = winner === "a" ? second.cardId : first.cardId;
    const logs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    expect(logs).toHaveLength(aReps + bReps);
    expect(logs.every((log) => log.cardId === winnerId)).toBe(true);
    for (const old of before.filter((log) => log.cardId === loserId)) {
      expect(logs.find((log) => log.id === old.id)!.updatedAt > old.updatedAt).toBe(true);
    }
    const cards = (await b.repo.sync.listChangedSince("cards", EPOCH)).filter((row) => !row.deletedAt);
    expect(cards).toMatchObject([{ id: winnerId, wordId: first.wordId, reps: Math.max(aReps, bReps) }]);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    for (const device of [a, b]) {
      const syncedLogs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(syncedLogs).toHaveLength(aReps + bReps);
      expect(syncedLogs.every((log) => log.cardId === first.cardId)).toBe(true);
    }
  });

  it.each([-5000, 0, 5000])("preserves higher merged reps against the owner's offline branch (%i ms)", async (skewMs) => {
    const { a, b, server } = createTwoDevices();
    a.advance(skewMs);
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await reviewMore(a, first.cardId, 2);
    await learn(b, "Harbor", 6);
    const logIds = await reviewIds([a, b]);
    expect(logIds).toHaveLength(9);
    await syncRound(b);
    await syncRound(a);
    await syncRound(b);
    await expectConverged([a, b], server, first.cardId, logIds, 6);
  });

  it("keeps a review made on the loser while the RPC is in flight and pushes it next", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const second = await learn(b, "Harbor", 3);
    server.controls.beforeRpcReply = async () => {
      server.controls.beforeRpcReply = undefined;
      await reviewMore(b, second.cardId, 1);
    };
    await syncRound(b);
    expect(await b.repo.sync.listChangedSince("cards", EPOCH)).toMatchObject([{ id: first.cardId, reps: 4 }]);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
    const [pending] = await b.repo.sync.listChangedSince("cards", EPOCH);
    const echoes = JSON.parse(b.storage.getItem("eng-learn.sync.echo.cards") ?? "{}");
    expect(echoes[first.cardId]).not.toBe(pending!.updatedAt);
    const logIds = await reviewIds([a, b]);
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 4);
  });

  it.each([false, true])("retries a committed merge after a lost response (loss=%s)", async (loss) => {
    const { a, b, server } = createTwoDevices({ skewMs: 5000 });
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const second = await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    server.controls.loseNextResponse = loss;
    if (loss) {
      await expect(syncRound(b)).rejects.toThrow("lost RPC response");
      expect(b.engine.getState().status).toBe("offline");
      expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
      expect(server.tableOf("eng_card_redirects").get(second.cardId)?.to_id).toBe(first.cardId);
    }
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 3);
    expect(server.tableOf("eng_card_redirects").size).toBe(1);
  });

  it("does not resurrect a redirected loser when the canonical word and card are deleted after a lost reply", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: 5000 });
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    server.controls.loseNextResponse = true;
    await expect(syncRound(b)).rejects.toThrow("lost RPC response");
    const c = createDevice(server);
    await syncRound(c);
    await c.run(async () => {
      const at = new Date(server.now().getTime() + 1000).toISOString();
      const [card] = await c.repo.sync.listChangedSince("cards", EPOCH);
      const [word] = await c.repo.words.listByStatus("learning");
      await c.repo.sync.applyRemote("cards", [{ ...card, updatedAt: at, deletedAt: at }]);
      await c.repo.sync.applyRemote("words", [{ ...word, updatedAt: at, deletedAt: at }]);
    });
    await syncRound(c);
    for (const device of [b, a, c, b, a, c]) await syncRound(device);
    for (const device of [a, b, c]) {
      const cards = await device.repo.sync.listChangedSince("cards", EPOCH);
      expect(cards.filter((card) => !card.deletedAt)).toEqual([]);
      expect(cards).toMatchObject([{ id: first.cardId, reps: 3, deletedAt: expect.any(String) }]);
      expect((await device.repo.cards.getReviewQueue(new Date("2030-01-01"))).dueTotal).toBe(0);
      const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
      expect(logs.map((log) => log.id).sort()).toEqual(logIds);
      expect(logs.every((log) => log.cardId === first.cardId)).toBe(true);
    }
    const cards = [...server.tableOf("eng_cards").values()];
    expect([...server.tableOf("eng_words").values()].filter((word) => word.deleted_at == null)).toEqual([]);
    expect(cards.filter((card) => card.deleted_at == null)).toEqual([]);
    expect(cards).toMatchObject([{ id: first.cardId, reps: 3 }]);
    const logs = [...server.tableOf("eng_review_logs").values()];
    expect(logs.map((log) => log.id).sort()).toEqual(logIds);
    expect(logs.every((log) => log.card_id === first.cardId)).toBe(true);
  });

  it("redirects a late loser log on insert and on a later update", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const second = await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    for (const device of [b, a, b]) await syncRound(device);
    const existing = [...server.tableOf("eng_review_logs").values()][0]!;
    const late = { ...existing, id: "late-log", card_id: second.cardId, client_updated_at: server.now().toISOString() };
    expect((await server.client.from("eng_review_logs").upsert([late], { onConflict: "id" })).error).toBeNull();
    expect(server.tableOf("eng_review_logs").get(late.id)?.card_id).toBe(first.cardId);
    expect((await server.client.from("eng_review_logs").update({ card_id: second.cardId, client_updated_at: server.now().toISOString() }).eq("id", late.id)).error).toBeNull();
    for (const device of [a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, [...logIds, late.id].sort(), 3);
  });

  it.each(["PGRST202", "42883"] as const)("falls back to round-6b server wins when RPC is missing (%s)", async (code) => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    server.controls.functionMissing = code;
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 1);
  });

  it.each(["row error", "malformed reply"])("keeps an RPC %s local and continues later stores", async (kind) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    await b.run(() => b.repo.activity.add({ block: "kelime", source: "manual", startedAt: b.now().toISOString(), seconds: 60 }));
    if (kind === "row error") server.controls.rpcError = { code: "42501", message: "merge refused" };
    else server.controls.malformedReply = true;
    await expect(syncRound(b)).rejects.toThrow();
    expect(b.engine.getState().status).toBe("error");
    expect(server.tableOf("eng_activity").size).toBe(1);
    server.controls.rpcError = undefined;
    server.controls.malformedReply = false;
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 3);
  });

  it("sends a settled local live twin back through merge after a pull discovers the canonical card", async () => {
    const { a, b, server } = createTwoDevices({ skewMs: -5000 });
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const second = await learn(b, "Harbor", 3);
    // Simulate a settled push cursor left by an older client; pull must make the card pending.
    const [local] = await b.repo.sync.listChangedSince("cards", EPOCH);
    b.storage.setItem("eng-learn.sync.push.cards", local!.updatedAt);
    const [word] = await b.repo.words.listByStatus("learning");
    await b.run(() => b.repo.sync.applyRemote("words", [{ ...word, id: first.wordId, updatedAt: new Date(Date.parse(word!.updatedAt) + 10000).toISOString() }]));
    const moved = (await b.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    b.storage.setItem("eng-learn.sync.push.cards", moved.updatedAt);
    const logIds = await reviewIds([a, b]);
    await syncRound(b);
    expect((await b.repo.sync.listChangedSince("cards", EPOCH))[0]).toMatchObject({ id: second.cardId, reps: 3 });
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 3);
  });

  it("propagates a one-step undo of the latest review on the canonical card", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    for (const device of [b, a, b]) await syncRound(device);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1);
    for (const device of [a, b]) await syncRound(device);
    const logIds = await reviewIds([a, b]);
    const last = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).sort((x, y) => String(y.reviewedAt).localeCompare(String(x.reviewedAt)))[0]!;
    expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 3 } });
    for (const device of [a, b, a]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 3, [last.id]);
  });

  it("undoes the counted server review despite a later short offline branch at reps 4", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    for (const device of [a, b]) await syncRound(device);
    await reviewMore(a, first.cardId, 3);
    b.advance(5000);
    await reviewMore(b, first.cardId, 1);
    const logIds = await reviewIds([a, b]);
    for (const device of [a, b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds, 4);
    const counted = server.tableOf("eng_cards").get(first.cardId)!.last_review_at;
    expect(await b.run(() => b.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 3 } });
    const undone = (await b.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((l) => l.deletedAt);
    expect(undone).toHaveLength(1);
    expect(Date.parse(String(undone[0]!.reviewedAt))).toBe(Date.parse(String(counted)));
    await expectSnapshotConverged([a, b], server, first.cardId, logIds, 3, [undone[0]!.id], false);
  });

  it("converges three devices including offline reviews of the server card", async () => {
    const { a, b, server } = createTwoDevices();
    const c = createDevice(server);
    const first = await learn(a, "harbor", 1);
    await learn(b, "Harbor", 3);
    await syncRound(a);
    await syncRound(c);
    await reviewMore(c, first.cardId, 2);
    const logIds = await reviewIds([a, b, c]);
    expect(logIds).toHaveLength(6);
    for (let i = 0; i < 2; i++) {
      for (const device of [b, a, c]) await syncRound(device);
    }
    await expectConverged([a, b, c], server, first.cardId, logIds, 3);
    const before = structuredClone(Object.values(TABLES).map(({ table }) => [...server.tableOf(table).values()]));
    for (let i = 0; i < 2; i++) {
      for (const device of [a, b, c]) {
        await syncRound(device);
        expect(device.engine.getState().pendingCount).toBe(0);
      }
    }
    expect(Object.values(TABLES).map(({ table }) => [...server.tableOf(table).values()])).toEqual(before);
  });

  it("leaves the server unchanged and pendingCount zero for two extra rounds after convergence", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    const logIds = await reviewIds([a, b]);
    for (const device of [b, a, b]) await syncRound(device);
    await expectConverged([a, b], server, first.cardId, logIds);
    const snapshot = () => Object.values(TABLES).map(({ table }) => [table, [...server.tableOf(table).values()]]);
    const before = structuredClone(snapshot());
    for (let i = 0; i < 2; i++) {
      for (const device of [a, b]) {
        await syncRound(device);
        expect(device.engine.getState().pendingCount).toBe(0);
      }
      expect(snapshot()).toEqual(before);
    }
    await expectConverged([a, b], server, first.cardId, logIds);
  });

  it("keeps B consistent with server deletion before its twin push without a counted orphan", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    await learn(b, "Harbor", 3);
    server.advance(1000);
    for (const [table, id] of [["eng_cards", first.cardId], ["eng_words", first.wordId]]) {
      const at = server.now().toISOString();
      const row = server.tableOf(table!).get(id!)!;
      expect((await server.client.from(table!).upsert([
        { ...row, deleted_at: at, client_updated_at: at },
      ], { onConflict: "id" })).error).toBeNull();
    }
    for (const device of [b, a, b]) await syncRound(device);
    const serverWords = [...server.tableOf("eng_words").values()].filter((row) => row.deleted_at == null);
    const words = await b.repo.words.listByStatus("learning");
    expect(words.map((word) => word.id).sort()).toEqual(serverWords.map((word) => word.id).sort());
    const queue = await b.repo.cards.getReviewQueue(new Date("2027-11-24T12:00:00Z"));
    expect(queue.cards.every(({ word }) => serverWords.some((row) => row.id === word.id))).toBe(true);
    const liveCards = [...server.tableOf("eng_cards").values()].filter((row) => row.deleted_at == null);
    expect(queue.cards.map(({ card }) => card.id).sort()).toEqual(liveCards.map((row) => row.id).sort());
    expect(queue.dueTotal).toBe(liveCards.length);
  });
});

describe("shared server SQL behavior", () => {
  it.each([
    ["word_id", "different-word"], ["stability", 123], ["stability_fast", 123],
    ["difficulty", 9], ["state", 3], ["schedule_status", "new"],
    ["due_at", EPOCH], ["last_review_at", EPOCH], ["scheduled_days", 123],
    ["learning_step", 123], ["lapses", 123], ["leech", true],
  ])("direct writes reject a reps drop regardless of changed %s", async (field, value) => {
    const server = createSharedServer();
    const a = createDevice(server);
    const first = await learn(a, "harbor", 2);
    await syncRound(a);
    const current = structuredClone(server.tableOf("eng_cards").get(first.cardId))!;
    const latest = [...server.tableOf("eng_review_logs").values()].find((log) => log.reviewed_at === current.last_review_at)!;
    const previous = latest.previous_card as Record<string, unknown>;
    const undo = toRemoteRow("cards", { ...previous, updatedAt: server.now().toISOString() } as Parameters<typeof toRemoteRow>[1]);
    expect(JSON.parse(JSON.stringify(previous))).toEqual(previous);
    expect(undo[field]).not.toBe(value);
    await server.client.from("eng_cards").upsert([{ ...undo, [field]: value }], { onConflict: "id" });
    const guarded = server.tableOf("eng_cards").get(first.cardId)!;
    for (const key of ["stability", "stability_fast", "difficulty", "state", "schedule_status", "due_at", "last_review_at", "reps", "scheduled_days", "learning_step", "lapses", "leech"]) expect(guarded[key]).toBe(current[key]);
    expect(guarded.word_id).toBe(field === "word_id" ? value : current.word_id);
  });

  it("snapshot timestamp equality accepts equivalent timezone representations", async () => {
    const server = createSharedServer();
    const a = createDevice(server);
    const first = await learn(a, "harbor", 2);
    await syncRound(a);
    const current = server.tableOf("eng_cards").get(first.cardId)!;
    const latest = [...server.tableOf("eng_review_logs").values()].find((log) => log.reviewed_at === current.last_review_at)!;
    const previous = latest.previous_card as Record<string, unknown>;
    const undo = toRemoteRow("cards", { ...previous, updatedAt: server.now().toISOString() } as Parameters<typeof toRemoteRow>[1]);
    undo.due_at = String(undo.due_at).replace("Z", "+00:00");
    undo.last_review_at = String(undo.last_review_at).replace("Z", "+00:00");
    await server.client.rpc("eng_push_card_bundle", { p_card: undo,
      p_logs: [{ ...latest, reviewed_at: String(latest.reviewed_at).replace("Z", "+00:00"), deleted_at: server.now().toISOString() }] });
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(1);
  });

  it.each(["deleted", "missing"])("log tombstone passes when its card is %s", async (kind) => {
    const server = createSharedServer();
    await server.client.from("eng_review_logs").upsert([{ id: "log", card_id: "card", previous_card: { reps: 1 } }], { onConflict: "id" });
    if (kind === "deleted") await server.client.from("eng_cards").upsert([{ id: "card", reps: 3, deleted_at: server.now().toISOString() }], { onConflict: "id" });
    await server.client.from("eng_review_logs").update({ deleted_at: server.now().toISOString(), client_updated_at: null }).eq("id", "log");
    expect(server.tableOf("eng_review_logs").get("log")?.deleted_at).not.toBeNull();
  });

  it("log guard follows redirects and compares OLD's snapshot", async () => {
    const server = createSharedServer();
    await server.client.from("eng_cards").upsert([{ id: "canonical", word_id: "word", reps: 3 }], { onConflict: "id" });
    await server.client.rpc("eng_merge_card", { p_card: { id: "loser", word_id: "word", reps: 1 } });
    await server.client.from("eng_review_logs").upsert([{ id: "log", card_id: "loser", previous_card: { reps: 1 } }], { onConflict: "id" });
    await server.client.from("eng_review_logs").update({ card_id: "loser", previous_card: { reps: 99 }, deleted_at: server.now().toISOString(), client_updated_at: null }).eq("id", "log");
    expect(server.tableOf("eng_review_logs").get("log")).toMatchObject({ card_id: "canonical", deleted_at: null, updated_at: expect.any(String) });
  });

  it("round 9b: rejected reps restore only FSRS, keeping NEW word/deletion metadata", async () => {
    const server = createSharedServer();
    const a = createDevice(server);
    const first = await learn(a, "harbor", 5);
    await syncRound(a);
    const old = structuredClone(server.tableOf("eng_cards").get(first.cardId))!;
    const at = server.now().toISOString();
    const fsrs = ["stability", "stability_fast", "difficulty", "state", "schedule_status", "due_at", "last_review_at", "reps", "scheduled_days", "learning_step", "lapses", "leech"];
    const changed = { ...old, word_id: "replacement-word", reps: 1, stability: 99, stability_fast: 99,
      difficulty: 9, state: 0, schedule_status: "new", due_at: EPOCH, last_review_at: EPOCH,
      scheduled_days: 99, learning_step: 99, lapses: 99, leech: true, client_updated_at: at };
    expect((await server.client.from("eng_cards").upsert([changed], { onConflict: "id" })).error).toBeNull();
    const guarded = server.tableOf("eng_cards").get(first.cardId)!;
    expect(guarded).toEqual({ ...changed, ...Object.fromEntries(fsrs.map((key) => [key, old[key]])), updated_at: at });
    expect(String(guarded.updated_at) > String(old.updated_at)).toBe(true);
  });

  it.each([
    { label: "equal history", oldTime: LOCAL_TIME.toISOString(), newTime: LOCAL_TIME.toISOString(), reps: 3 },
    { label: "newer history", oldTime: LOCAL_TIME.toISOString(), newTime: "2026-11-24T12:01:00.000Z", reps: 3 },
    { label: "both null", oldTime: null, newTime: null, reps: 3 },
    { label: "from null to time", oldTime: null, newTime: LOCAL_TIME.toISOString(), reps: 3 },
    { label: "drop two with older history", oldTime: LOCAL_TIME.toISOString(), newTime: EPOCH, reps: 2 },
  ])("round 9b: rejects $label as an undo", async ({ oldTime, newTime, reps }) => {
    const server = createSharedServer();
    const query = server.client.from("eng_cards");
    await query.upsert([{ id: "card", word_id: "word", reps: 4, last_review_at: oldTime }], { onConflict: "id" });
    await query.upsert([{ id: "card", reps, last_review_at: newTime, client_updated_at: server.now().toISOString() }], { onConflict: "id" });
    expect(server.tableOf("eng_cards").get("card")).toMatchObject({ reps: 4, last_review_at: oldTime });
  });

  it("round 9b: compresses X->Y then Y->C for late logs and retried X merges", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_cards");
    await query.upsert([{ id: "Y", word_id: "word", reps: 2 }], { onConflict: "id" });
    expect(await server.client.rpc("eng_merge_card", { p_card: { id: "X", word_id: "word", reps: 1 } }))
      .toMatchObject({ error: null, data: { canonical_id: "Y" } });
    await server.client.from("eng_review_logs").upsert([{ id: "early", card_id: "X" }], { onConflict: "id" });
    expect(server.tableOf("eng_review_logs").get("early")?.card_id).toBe("Y");
    await query.update({ deleted_at: server.now().toISOString(), client_updated_at: null }).eq("id", "Y");
    await query.upsert([{ id: "C", word_id: "word", reps: 4 }], { onConflict: "id" });
    expect(await server.client.rpc("eng_merge_card", { p_card: { id: "Y", word_id: "word", reps: 3 } }))
      .toMatchObject({ error: null, data: { canonical_id: "C" } });
    // First verify the actual failure paths, then inspect the compressed redirects.
    await server.client.from("eng_review_logs").upsert([{ id: "late", card_id: "X" }], { onConflict: "id" });
    expect(server.tableOf("eng_review_logs").get("late")?.card_id).toBe("C");
    expect(await server.client.rpc("eng_merge_card", { p_card: { id: "X", word_id: "word", reps: 1 } }))
      .toMatchObject({ error: null, data: { canonical_id: "C", card: { reps: 4 } } });
    expect(server.tableOf("eng_card_redirects").get("X")).toMatchObject({ to_id: "C", client_updated_at: null });
    expect(server.tableOf("eng_card_redirects").get("Y")?.to_id).toBe("C");
    expect([...server.tableOf("eng_review_logs").values()].every((log) => log.card_id === "C")).toBe(true);
    expect([...server.tableOf("eng_cards").values()].filter((card) => card.deleted_at == null).map((card) => card.id)).toEqual(["C"]);
  });

  it("models merge insert, same-id no-op, explicit ownership and preservation of server creation time", async () => {
    const server = createSharedServer();
    const base = { id: "first", word_id: "word", reps: 1, stability: 1, stability_fast: 1,
      difficulty: 5, state: 2, schedule_status: "review", due_at: LOCAL_TIME.toISOString(),
      last_review_at: LOCAL_TIME.toISOString(), scheduled_days: 1, learning_step: 0, lapses: 0,
      leech: false, created_at: EPOCH, user_id: "forged-user", updated_at: "2099-01-01T00:00:00Z" };
    const inserted = await server.client.rpc("eng_merge_card", { p_card: base });
    expect(inserted).toMatchObject({ error: null, data: { canonical_id: base.id, selected: true,
      card: { user_id: USER_ID, created_at: EPOCH } } });
    const snapshot = structuredClone(server.tableOf("eng_cards").get(base.id));
    expect(snapshot?.updated_at).not.toBe(base.updated_at);
    expect(await server.client.rpc("eng_merge_card", { p_card: { ...base, reps: 4 } })).toMatchObject({
      error: null, data: { selected: false, card: snapshot },
    });
    expect(await server.client.rpc("eng_merge_card", { p_card: { ...base, id: "loser", reps: 4, created_at: LOCAL_TIME.toISOString() } })).toMatchObject({
      error: null, data: { selected: true, card: { id: base.id, reps: 4, created_at: EPOCH } },
    });
  });

  it("tombstones an existing loser on another word and moves uploaded logs past 0003's stale check", async () => {
    const server = createSharedServer();
    const at = server.now().toISOString();
    await server.client.from("eng_cards").upsert([
      { id: "canonical", word_id: "word", reps: 1, client_updated_at: EPOCH },
      { id: "loser", word_id: "dead-word", reps: 3, client_updated_at: EPOCH },
    ], { onConflict: "id" });
    await server.client.from("eng_review_logs").upsert([{ id: "log", card_id: "loser", client_updated_at: EPOCH }], { onConflict: "id" });
    const merged = await server.client.rpc("eng_merge_card", { p_card: { id: "loser", word_id: "word", reps: 3 } });
    expect(merged).toMatchObject({ error: null, data: { selected: true, canonical_id: "canonical", card: { reps: 3, client_updated_at: null } } });
    expect(server.tableOf("eng_cards").get("loser")).toMatchObject({ deleted_at: expect.any(String), client_updated_at: null });
    expect(server.tableOf("eng_review_logs").get("log")).toMatchObject({ card_id: "canonical", client_updated_at: null });
    const updated = [server.tableOf("eng_cards").get("canonical"), server.tableOf("eng_cards").get("loser"), server.tableOf("eng_review_logs").get("log")];
    expect(new Set(updated.map((row) => row!.updated_at)).size).toBe(1);
    expect(String(updated[0]!.updated_at) > at).toBe(true);
  });

  it("runs set_updated_at before the reps guard, rejecting even a fresh direct one-step undo", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_cards");
    await query.upsert([{ id: "card", word_id: "word", reps: 5, last_review_at: LOCAL_TIME.toISOString(),
      stability: 1.2345678901234567, stability_fast: 0.12345678901234568, difficulty: 5.1,
      state: 2, schedule_status: "review", due_at: LOCAL_TIME.toISOString(), scheduled_days: 1.5,
      learning_step: 0, lapses: 2, leech: false, created_at: EPOCH }], { onConflict: "id" });
    const original = structuredClone(server.tableOf("eng_cards").get("card"))!;
    const editAt = server.now().toISOString();
    await query.upsert([{ id: "card", reps: 2, client_updated_at: editAt }], { onConflict: "id" });
    const guarded = structuredClone(server.tableOf("eng_cards").get("card"))!;
    expect(guarded).toEqual({ ...original, client_updated_at: editAt, updated_at: expect.any(String) });
    expect(String(guarded.updated_at) > String(original.updated_at)).toBe(true);
    await query.upsert([{ id: "card", reps: 4, client_updated_at: EPOCH }], { onConflict: "id" });
    expect(server.tableOf("eng_cards").get("card")).toEqual(guarded);
    // The new contract needs an actual live snapshot, not merely an older review time.
    await server.client.from("eng_review_logs").upsert([{ id: "undo-log", card_id: "card",
      reviewed_at: LOCAL_TIME.toISOString(), previous_card: fromRemoteRow("cards", { ...guarded, reps: 4, last_review_at: null }) }], { onConflict: "id" });
    await query.upsert([{ id: "card", reps: 4, last_review_at: null, client_updated_at: server.now().toISOString() }], { onConflict: "id" });
    expect(server.tableOf("eng_cards").get("card")?.reps).toBe(5);
  });

  it("stamps all rows in each upsert or update once, advancing 1 ms per statement", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    server.advance(2000);
    const firstAt = server.now().toISOString();
    expect((await query.upsert([{ id: "one" }, { id: "two" }], { onConflict: "id" })).error).toBeNull();
    expect([...server.tableOf("eng_review_logs").values()].map((row) => row.updated_at)).toEqual([firstAt, firstAt]);
    expect(server.now().getTime()).toBe(Date.parse(firstAt) + 1);
    const secondAt = server.now().toISOString();
    expect((await query.update({ card_id: "winner" })).error).toBeNull();
    expect([...server.tableOf("eng_review_logs").values()].map((row) => row.updated_at)).toEqual([secondAt, secondAt]);
    expect(server.now().getTime()).toBe(Date.parse(secondAt) + 1);
  });

  it("rejects duplicate ids in one upsert with 21000 without writing any rows", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    expect((await query.upsert([{ id: "old", card_id: "original" }], { onConflict: "id" })).error).toBeNull();
    const before = structuredClone([...server.tableOf("eng_review_logs").values()]);
    const at = server.now().getTime();
    const result = await query.upsert([{ id: "new" }, { id: "old" }, { id: "old" }], { onConflict: "id" });
    expect(result.error?.code).toBe("21000");
    expect([...server.tableOf("eng_review_logs").values()]).toEqual(before);
    expect(server.now().getTime()).toBe(at + 1);
  });

  it.each([
    { table: "eng_inbox", column: "normalized" },
    { table: "eng_words", column: "normalized" },
    { table: "eng_cards", column: "word_id" },
    { table: "eng_videos", column: "youtube_id" },
  ])("enforces the $table partial unique key atomically and per user", async ({ table, column }) => {
    const server = createSharedServer();
    const query = server.client.from(table);
    const rows = server.tableOf(table);
    rows.set("foreign", { id: "foreign", user_id: "another-user", [column]: "same", updated_at: EPOCH });
    expect((await query.upsert([{ id: "first", [column]: "same" }], { onConflict: "id" })).error).toBeNull();
    const stored = structuredClone(server.tableOf(table).get("first"));
    const refused = await query.upsert([
      { id: "unrelated", [column]: "different" }, { id: "twin", [column]: "same" },
    ], { onConflict: "id" });
    expect(refused.error?.code).toBe("23505");
    expect(server.tableOf(table).has("unrelated")).toBe(false);
    expect(server.tableOf(table).has("twin")).toBe(false);
    expect(server.tableOf(table).get("first")).toEqual(stored);
    expect((await query.upsert([{ id: "dead", [column]: "same", deleted_at: server.now().toISOString() }], { onConflict: "id" })).error).toBeNull();
    const visible = await query.select("*").eq(column, "same");
    expect(visible.data?.map((row) => row.id).sort()).toEqual(["dead", "first"]);
    expect(visible.data?.every((row) => row.user_id === USER_ID)).toBe(true);
    expect(String(server.tableOf(table).get("dead")!.updated_at) > String(stored!.updated_at)).toBe(true);
  });

  it("silently preserves OLD on stale upserts and updates, comparing against server updated_at", async () => {
    const server = createSharedServer();
    const query = server.client.from("eng_review_logs");
    await query.upsert([{ id: "log", card_id: "first", client_updated_at: EPOCH }], { onConflict: "id" });
    const old = structuredClone(server.tableOf("eng_review_logs").get("log"))!;
    // Newer than the old client edit, but older than the server stamp: it must still be refused.
    const stale = { card_id: "stale", client_updated_at: LOCAL_TIME.toISOString() };
    expect((await query.upsert([{ id: "log", ...stale }], { onConflict: "id" })).error).toBeNull();
    expect((await query.update(stale).eq("card_id", "first")).error).toBeNull();
    expect(server.tableOf("eng_review_logs").get("log")).toEqual(old);
    expect((await query.update({ card_id: "winner", client_updated_at: String(old.updated_at) }).eq("card_id", "first")).error).toBeNull();
    const updated = server.tableOf("eng_review_logs").get("log")!;
    expect(updated.card_id).toBe("winner");
    expect(String(updated.updated_at) > String(old.updated_at)).toBe(true);
  });
});

// Round 9f port: undoTwin.scratch.test.ts
it("undo made on the losing twin before its first push stays undone after the merge", async () => {
  const { a, b, server } = createTwoDevices();
  const first = await learn(a, "harbor", 1);
  await syncRound(a);
  await learn(b, "Harbor", 2);
  const undo = await b.run(() => b.repo.cards.undoLastReview());
  expect(undo.ok).toBe(true);
  const bLogs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
  const undone = bLogs.filter((l) => l.deletedAt).map((l) => l.id);
  expect(undone).toHaveLength(1);
  const rpc = vi.spyOn(server.client, "rpc");
  for (const d of [b, a, b, a]) await syncRound(d);
  const mergeIndex = rpc.mock.calls.findIndex(([name]) => name === "eng_merge_card");
  expect(mergeIndex).toBeGreaterThanOrEqual(0);
  expect(rpc.mock.calls.slice(mergeIndex + 1)).toContainEqual([
    "eng_push_card_bundle", { p_card: null, p_logs: expect.arrayContaining([
      expect.objectContaining({ id: undone[0], card_id: first.cardId, deleted_at: expect.any(String) }),
    ]) },
  ]);
  rpc.mockRestore();
  const serverLog = server.tableOf("eng_review_logs").get(undone[0]!);
  expect(serverLog?.deleted_at).not.toBeNull();
  await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 1, undone, false);
});


// Round 9f port: lostRetry.scratch.test.ts
it("another device's accepted undo survives a lost-response bundle retry", async () => {
  const { a, b, server } = createTwoDevices();
  const first = await learn(a, "harbor", 1);
  await syncRound(a);
  await syncRound(b);
  server.advance(1000);
  await b.run(async () => {
    expect((await b.repo.cards.reviewCard(first.cardId, "good", b.now())).ok).toBe(true);
  });
  const bLogs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
  const latest = bLogs.sort((x, y) => String(y.reviewedAt).localeCompare(String(x.reviewedAt)))[0]!;
  server.controls.loseNextResponse = true;
  await expect(syncRound(b)).rejects.toThrow();
  expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(2);
  server.advance(1000);
  await syncRound(a);
  expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
  await syncRound(a);
  server.advance(1000);
  await syncRound(b);
  await syncRound(a);
  expect(server.tableOf("eng_review_logs").get(latest.id)?.deleted_at).not.toBeNull();
  await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 1, [latest.id]);
});


// Round 9f port: missingLogTombstone.test.ts
describe("round 9f: stale undo of a log the server never received", () => {
  it("keeps the log live when the server card moved on (M2 analogue)", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "stale", 2);
    await syncRound(a); await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1); // A: reps 3, log L (local only)
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    // Card-only success (as in the 9d INSERT-tombstone test): L never reaches the server.
    expect((await server.client.from("eng_cards").upsert([toRemoteRow("cards", card)], { onConflict: "id" })).error).toBeNull();
    server.advance(10000);
    await syncRound(b);
    await reviewMore(b, first.cardId, 1); // B: reps 4, log M
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(4);
    // A undoes L offline while still believing reps 3.
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    for (let i = 0; i < 3; i++) { await syncRound(a); await syncRound(b); }
    const srvCard = server.tableOf("eng_cards").get(first.cardId)!;
    const live = [...server.tableOf("eng_review_logs").values()].filter((l) => l.deleted_at == null);
    expect(live).toHaveLength(Number(srvCard.reps));
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 4);
  });
});


// Round 9f port: scenarios.test.ts
describe("review round 9e scenarios", () => {
  it("A: an offline undo on a twin card survives the merge path", async () => {
    const { a, b, server } = createTwoDevices();
    await learn(b, "harbor", 1);
    await syncRound(b);
    await learn(a, "Harbor", 2);
    const undone = await newestRound9fLog(a);
    expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 1 } });
    for (const device of [a, b, a, b]) await syncRound(device);
    const serverLog = server.tableOf("eng_review_logs").get(undone.id);
    const localLog = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => l.id === undone.id);
    expect(serverLog?.deleted_at).not.toBeNull();
    expect(localLog?.deletedAt).toBeDefined();
    const canonical = [...server.tableOf("eng_cards").values()].find((c) => c.deleted_at == null)!;
    await expectSnapshotConverged([a, b], server, String(canonical.id), await reviewIds([a, b]), 1, [undone.id], false);
  });

  it.each([false, true])("B: a retried lost bundle does not revert another device's undo (re-rate %s)", async (rerate) => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "retry", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1);
    const la = await newestRound9fLog(a);
    server.controls.loseNextResponse = true;
    await expect(syncRound(a)).rejects.toThrow("lost RPC response");
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(4);
    server.advance(10000);
    await syncRound(b);
    expect(await b.run(() => b.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 3 } });
    if (rerate) { server.advance(1000); await reviewMore(b, first.cardId, 1); }
    await syncRound(b);
    expect(server.tableOf("eng_review_logs").get(la.id)?.deleted_at).not.toBeNull();
    server.advance(10000);
    for (const device of [a, b, a, b]) await syncRound(device);
    const card = server.tableOf("eng_cards").get(first.cardId)!;
    const live = [...server.tableOf("eng_review_logs").values()].filter((l) => l.deleted_at == null).length;
    expect(server.tableOf("eng_review_logs").get(la.id)?.deleted_at).not.toBeNull();
    expect(card.reps).toBe(rerate ? 4 : 3);
    expect(live).toBe(card.reps);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), rerate ? 4 : 3, [la.id]);
  });

  it("C: a missing log stays live when a stale undo is rejected", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "partial", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1);
    const l4 = await newestRound9fLog(a);
    // One round on the per-table path (PostgREST schema cache not yet reloaded): card ok, log push lost.
    server.controls.functionMissing = "PGRST202";
    const from = server.client.from.bind(server.client);
    const spy = vi.spyOn(server.client, "from").mockImplementation((name: string) => {
      const table = from(name);
      if (name !== "eng_review_logs") return table;
      return { ...table, upsert: async () => { throw new Error("Failed to fetch"); } } as typeof table;
    });
    await expect(syncRound(a)).rejects.toThrow();
    spy.mockRestore();
    server.controls.functionMissing = null;
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(4);
    expect(server.tableOf("eng_review_logs").has(l4.id)).toBe(false);
    server.advance(10000);
    await syncRound(b);
    await reviewMore(b, first.cardId, 1);
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(5);
    expect(await a.run(() => a.repo.cards.undoLastReview())).toMatchObject({ ok: true, card: { reps: 3 } });
    for (const device of [a, b, a, b]) await syncRound(device);
    const card = server.tableOf("eng_cards").get(first.cardId)!;
    const live = [...server.tableOf("eng_review_logs").values()].filter((l) => l.deleted_at == null).length;
    expect(card.reps).toBe(5);
    expect(server.tableOf("eng_review_logs").get(l4.id)?.deleted_at).toBeNull();
    expect(live).toBe(5);
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 5);
  });
});


// Round 9f port: scenarios2.test.ts
describe("review round 9e scenarios 2", () => {
  it.each([0, 5000, -5000])("D: undo of the counted review after a concurrent same-id review (skew %i)", async (skewMs) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const first = await learn(a, "concurrent", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1); // La, counted
    const la = await newestRound9fLog(a);
    b.advance(3000);
    await reviewMore(b, first.cardId, 1); // Lb, later wall time, not counted
    const lb = await newestRound9fLog(b);
    await syncRound(a);
    await syncRound(b);
    await syncRound(a);
    const card = server.tableOf("eng_cards").get(first.cardId)!;
    const result = await a.run(() => a.repo.cards.undoLastReview());
    expect(result.ok).toBe(true);
    const undone = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((l) => l.deletedAt);
    expect(undone).toHaveLength(1);
    expect(Date.parse(String(undone[0]!.reviewedAt))).toBe(Date.parse(String(card.last_review_at)));
    expect(undone[0]!.id).toBe(la.id);
    await syncRound(a);
    // Step d must accept La: the settled parent chain no longer counts it.
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
    expect(server.tableOf("eng_review_logs").get(la.id)?.deleted_at).not.toBeNull();
    expect(server.tableOf("eng_review_logs").get(lb.id)?.deleted_at).toBeNull();
    const parent = la.previousCard as Card;
    const settled = fromRemoteRow("cards", server.tableOf("eng_cards").get(first.cardId)!);
    for (const key of ["stability", "stabilityFast", "difficulty", "state", "scheduleStatus", "dueAt",
      "lastReviewAt", "reps", "scheduledDays", "learningStep", "lapses", "leech"] as const) {
      expect(settled[key]).toEqual(parent[key]);
    }
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 3, [la.id], false);
  });

  it.each([
    ["cards", 0], ["cards", 5000], ["cards", -5000],
    ["reviewLogs", 0], ["reviewLogs", 5000], ["reviewLogs", -5000],
  ] as const)("E: undo between pull listing and applyRemote survives (%s, skew %i)", async (raceStore, skewMs) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const first = await learn(a, "race", 3);
    await syncRound(a);
    await syncRound(b);
    server.advance(10000);
    await reviewMore(a, first.cardId, 1);
    await syncRound(a);
    await syncRound(b);
    // An unrelated review keeps the pull pages non-empty.
    server.advance(10000);
    await learn(a, "other", 1);
    await syncRound(a);
    const original = b.repo.sync.applyRemote.bind(b.repo.sync);
    let fired = false;
    b.repo.sync.applyRemote = async (store, rows, pending) => {
      if (store === raceStore && !fired) {
        fired = true;
        expect((await b.repo.cards.undoLastReview()).ok).toBe(true);
      }
      return original(store, rows, pending);
    };
    await syncRound(b);
    b.repo.sync.applyRemote = original;
    expect((await b.repo.sync.listChangedSince("cards", EPOCH)).find((card) => card.id === first.cardId)?.reps).toBe(3);
    expect((await b.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((log) => log.deletedAt)).toHaveLength(1);
    expect(b.engine.getState().pendingCount).toBeGreaterThan(0);
    for (const device of [b, a, b]) await syncRound(device);
    expect(fired).toBe(true);
    expect(server.tableOf("eng_cards").get(first.cardId)?.reps).toBe(3);
    const undone = [...server.tableOf("eng_review_logs").values()].filter((log) => log.deleted_at != null);
    expect(undone).toHaveLength(1);
    const ids = await reviewIds([a, b]);
    const check = async () => {
      expect([...server.tableOf("eng_cards").values()].filter((card) => card.deleted_at == null)).toHaveLength(2);
      expect([...server.tableOf("eng_review_logs").values()].filter((log) => log.deleted_at == null)).toHaveLength(4);
      for (const device of [a, b]) {
        const cards = (await device.repo.sync.listChangedSince("cards", EPOCH)).filter((card) => !card.deletedAt);
        expect(cards).toHaveLength(2);
        expect(cards.find((card) => card.id === first.cardId)?.reps).toBe(3);
        expect(new Set(cards.map((card) => card.wordId)).size).toBe(2);
        const logs = await device.repo.sync.listChangedSince("reviewLogs", EPOCH);
        expect(logs.map((log) => log.id).sort()).toEqual(ids);
        expect(logs.filter((log) => log.deletedAt).map((log) => log.id)).toEqual([String(undone[0]!.id)]);
        expect(device.engine.getState().pendingCount).toBe(0);
      }
    };
    await check();
    for (let round = 0; round < 2; round++) for (const device of [a, b]) await syncRound(device);
    await check();
  });
});


async function newestRound9fLog(device: Device) {
  const logs = (await device.repo.sync.listChangedSince("reviewLogs", EPOCH)).filter((l) => !l.deletedAt);
  return logs.sort((x, y) => String(y.reviewedAt).localeCompare(String(x.reviewedAt)))[0]!;
}

describe("round 9f server tombstone migration", () => {
  it("preserves an accepted loser tombstone when merge moves existing server logs", async () => {
    const { a, b, server } = createTwoDevices();
    const first = await learn(a, "harbor", 1);
    await syncRound(a);
    const loser = await learn(b, "Harbor", 2);
    expect((await b.run(() => b.repo.cards.undoLastReview())).ok).toBe(true);
    const logs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    const undone = logs.find((l) => l.deletedAt)!;
    const before = undone.deletedAt;
    // Card absent: step d(b) accepts these logs before the canonical merge.
    expect((await server.client.rpc("eng_push_card_bundle", {
      p_card: null, p_logs: logs.map((l) => toRemoteRow("reviewLogs", l)),
    })).error).toBeNull();
    const card = (await b.repo.sync.listChangedSince("cards", EPOCH)).find((c) => c.id === loser.cardId)!;
    const canonicalWord = server.tableOf("eng_cards").get(first.cardId)!.word_id;
    expect((await server.client.rpc("eng_merge_card", { p_card: { ...toRemoteRow("cards", card), word_id: canonicalWord } })).error).toBeNull();
    expect(server.tableOf("eng_review_logs").get(undone.id)).toMatchObject({ card_id: first.cardId, deleted_at: before });
    await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 1, [undone.id], false);
  });
});

it("round 9f: a logs-only redirected group resolves the canonical id through bundles", async () => {
  const { a, b, server } = createTwoDevices({ skewMs: -5000 });
  const first = await learn(a, "redirected", 1);
  await syncRound(a);
  const second = await learn(b, "Redirected", 2);
  expect((await b.run(() => b.repo.cards.undoLastReview())).ok).toBe(true);
  const original = (await b.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => l.deletedAt)!;
  await expectSnapshotConverged([a, b], server, first.cardId, await reviewIds([a, b]), 1, [original.id], false);
  const c = createDevice(server);
  // Only this old-id log is pending: no local card row is available for the merge request.
  await c.repo.sync.applyRemote("reviewLogs", [{ ...original, cardId: second.cardId }]);
  const rpc = vi.spyOn(server.client, "rpc");
  await syncRound(c);
  expect(rpc.mock.calls[0]).toMatchObject(["eng_push_card_bundle", { p_card: null }]);
  expect(rpc.mock.calls.some(([name]) => name === "eng_merge_card")).toBe(true);
  expect(rpc.mock.calls.at(-1)).toMatchObject(["eng_push_card_bundle", {
    p_card: null, p_logs: [expect.objectContaining({ id: original.id, card_id: first.cardId })],
  }]);
  rpc.mockRestore();
  await expectSnapshotConverged([a, b, c], server, first.cardId, await reviewIds([a, b]), 1, [original.id], false);
});

// Round 9h: ported offlineUndo.test.ts and lostRetryMore.test.ts (all clock skews).
describe.each([0, 5000, -5000])("offline review twice, undo once (skew %i)", (skewMs) => {
  it("existing synced card: undone log must stay a tombstone", async () => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const { cardId } = await learn(b, "harbor", 2); // B is the skewed device
    await syncRound(b); await syncRound(a);
    server.advance(10000);
    await reviewMore(b, cardId, 2); // offline: L3 (prev reps 2), L4 (prev reps 3)
    const undo = await b.run(() => b.repo.cards.undoLastReview());
    expect(undo.ok).toBe(true);
    const undone = (await b.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => l.deletedAt)!;
    for (let i = 0; i < 2; i++) { await syncRound(b); await syncRound(a); }
    await expectSnapshotConverged([a, b], server, cardId, await reviewIds([a, b]), 3, [undone.id]);
  });

  it("brand-new card never synced: undone log must stay a tombstone", async () => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const { cardId } = await learn(b, "anchor", 2); // offline from the start: L1, L2
    const undo = await b.run(() => b.repo.cards.undoLastReview());
    expect(undo.ok).toBe(true);
    const undone = (await b.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => l.deletedAt)!;
    for (let i = 0; i < 2; i++) { await syncRound(b); await syncRound(a); }
    await expectSnapshotConverged([a, b], server, cardId, await reviewIds([a, b]), 1, [undone.id]);
  });
});

describe.each([0, 5000, -5000])("lost reply, other device undoes, then one more review (skew %i)", (skewMs) => {
  it("accepted undo of L1 must not be overwritten by A's next forward bundle", async () => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const { cardId } = await learn(a, "harbor", 2);
    await syncRound(a); await syncRound(b);
    server.advance(10000);
    await reviewMore(a, cardId, 1); // L1, reps 3
    const l1 = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => (l.previousCard as { reps: number }).reps === 2)!;
    server.controls.loseNextResponse = true;
    await syncRound(a).catch(() => {});
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(3);
    server.advance(10000);
    await syncRound(b);
    expect((await b.run(() => b.repo.cards.undoLastReview())).ok).toBe(true);
    await syncRound(b);
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(2);
    expect(server.tableOf("eng_review_logs").get(l1.id)?.deleted_at).not.toBeNull();
    server.advance(10000);
    await reviewMore(a, cardId, 1); // A, still unaware: L2 on top of L1, reps 4
    for (let i = 0; i < 2; i++) { await syncRound(a); await syncRound(b); }
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(2);
    expect([...server.tableOf("eng_review_logs").values()].filter((l) => l.deleted_at == null)).toHaveLength(3);
    const l2 = [...server.tableOf("eng_review_logs").values()].find((l) =>
      (l.previous_card as { lastReviewAt: string }).lastReviewAt === l1.reviewedAt)!;
    expect(l2).toBeDefined();
    expect(l2.deleted_at).toBeNull();
    await expectSnapshotConverged([a, b], server, cardId, await reviewIds([a, b]), 2, [l1.id], false);
  });
});


describe("round 9h chain eligibility", () => {
  it("keeps OLD FSRS but passes metadata when the parent timestamp differs", async () => {
    const { a, server } = createTwoDevices();
    const { cardId } = await learn(a, "wrong-parent", 2);
    await syncRound(a);
    const old = structuredClone(server.tableOf("eng_cards").get(cardId))!;
    await reviewMore(a, cardId, 1);
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const log = await newestRound9fLog(a);
    const result = await server.client.rpc("eng_push_card_bundle", {
      p_card: { ...toRemoteRow("cards", card), word_id: "repointed", stability: 999 },
      p_logs: [{ ...toRemoteRow("reviewLogs", log), previous_card: { ...(log.previousCard as Card), lastReviewAt: EPOCH } }],
    });
    expect(result.error).toBeNull();
    expect(server.tableOf("eng_cards").get(cardId)).toMatchObject({
      word_id: "repointed", reps: old.reps, last_review_at: old.last_review_at, stability: old.stability,
    });
    expect(server.tableOf("eng_cards").get(cardId)?.updated_at).not.toBe(old.updated_at);
  });

  it("accepts NEW through its producing log despite a live sibling", async () => {
    const { a, server } = createTwoDevices();
    const { cardId } = await learn(a, "ambiguous", 1);
    await syncRound(a);
    await reviewMore(a, cardId, 1);
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const log = toRemoteRow("reviewLogs", await newestRound9fLog(a));
    const result = await server.client.rpc("eng_push_card_bundle", {
      p_card: toRemoteRow("cards", card), p_logs: [log, { ...log, id: "alternative", reviewed_at: EPOCH }],
    });
    expect(result.error).toBeNull();
    expect([...server.tableOf("eng_review_logs").values()].every((log) => log.deleted_at == null)).toBe(true);
    expect(server.tableOf("eng_cards").get(cardId)).toMatchObject({ reps: card.reps, last_review_at: card.lastReviewAt });
  });

  it("applies an already-live server log using equal instants with different offsets", async () => {
    const { a, server } = createTwoDevices();
    const { cardId } = await learn(a, "server-history", 1);
    await syncRound(a);
    await reviewMore(a, cardId, 1);
    const card = (await a.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    const log = await newestRound9fLog(a);
    const parentTime = (log.previousCard as Card).lastReviewAt!;
    const row = { ...toRemoteRow("reviewLogs", log), previous_card: {
      ...(log.previousCard as Card), lastReviewAt: parentTime.replace("Z", "+00:00"),
    } };
    expect((await server.client.rpc("eng_push_card_bundle", { p_card: null, p_logs: [row] })).error).toBeNull();
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(1);
    expect((await server.client.rpc("eng_push_card_bundle", { p_card: toRemoteRow("cards", card), p_logs: [] })).error).toBeNull();
    expect(server.tableOf("eng_cards").get(cardId)).toMatchObject({ reps: 2, last_review_at: card.lastReviewAt });
  });

  it("protects a counted ancestor in a logs-only bundle", async () => {
    const { a, server } = createTwoDevices();
    const { cardId } = await learn(a, "ancestor", 3);
    await syncRound(a);
    const log = (await a.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => (l.previousCard as Card).reps === 0)!;
    expect((await server.client.rpc("eng_push_card_bundle", { p_card: null,
      p_logs: [{ ...toRemoteRow("reviewLogs", log), deleted_at: server.now().toISOString() }],
    })).error).toBeNull();
    expect(server.tableOf("eng_review_logs").get(log.id)?.deleted_at).toBeNull();
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(3);
  });
});

// Round 9i: reaching NEW wins even when another live child could apply.
describe.each([0, 5000, -5000])("round 9i first matching state (skew %i)", (skewMs) => {
  it.each([0, 1])("accepts NEW after %i steps with live history beyond it", async (steps) => {
    const { a, b, server } = createTwoDevices({ skewMs });
    const { cardId } = await learn(b, "walk-stop", 1);
    await syncRound(b); await syncRound(a);
    let target = (await b.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    if (steps) {
      await reviewMore(b, cardId, 1);
      target = (await b.repo.sync.listChangedSince("cards", EPOCH))[0]!;
    }
    await reviewMore(b, cardId, 1);
    const logs = await b.repo.sync.listChangedSince("reviewLogs", EPOCH);
    // Install live descendants without changing the server card.
    expect((await server.client.rpc("eng_push_card_bundle", {
      p_card: null, p_logs: logs.map((log) => toRemoteRow("reviewLogs", log)),
    })).error).toBeNull();
    const incoming = { ...toRemoteRow("cards", target), stability: 999, leech: true };
    for (let retry = 0; retry < 2; retry++) {
      expect((await server.client.rpc("eng_push_card_bundle", { p_card: incoming, p_logs: [] })).error).toBeNull();
      expect(server.tableOf("eng_cards").get(cardId)).toMatchObject({
        reps: target.reps, last_review_at: target.lastReviewAt, stability: 999, leech: true,
      });
    }
    expect([...server.tableOf("eng_review_logs").values()].every((log) => log.deleted_at == null)).toBe(true);

  });
});


async function localCard(device: Device, id: string) {
  return (await device.repo.sync.listChangedSince("cards", EPOCH)).find((c) => c.id === id)!;
}
async function localLog(device: Device, id: string) {
  return (await device.repo.sync.listChangedSince("reviewLogs", EPOCH)).find((l) => l.id === id);
}
// Build: card at reps 3 on both; A reviews La (counted), B reviews Lb (sibling, rejected, live orphan).
async function concurrentBranch(skewMs: number) {
  const { a, b, server } = createTwoDevices({ skewMs });
  const { cardId } = await learn(a, "branch", 3);
  await syncRound(a); await syncRound(b);
  server.advance(10000);
  await reviewMore(a, cardId, 1);
  const la = await newestRound9fLog(a);
  b.advance(3000);
  await reviewMore(b, cardId, 1);
  const lb = await newestRound9fLog(b);
  await syncRound(a); await syncRound(b); await syncRound(a);
  expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(4);
  expect(server.tableOf("eng_review_logs").get(lb.id)?.deleted_at ?? null).toBeNull();
  return { a, b, server, cardId, la, lb };
}

describe.each([0, 5000, -5000])("R9I-1 offline undo + re-rate next to a live sibling (skew %i)", (skewMs) => {
  it("undo of La must propagate and the re-rate La2 must be counted", async () => {
    const { a, b, server, cardId, la } = await concurrentBranch(skewMs);
    server.advance(10000);
    const undo = await a.run(() => a.repo.cards.undoLastReview());
    expect(undo.ok).toBe(true);
    expect((await localLog(a, la.id))?.deletedAt).toBeTruthy();
    await reviewMore(a, cardId, 1); // re-rate La2 from the reps-3 parent
    const la2 = await newestRound9fLog(a);
    expect(la2.id).not.toBe(la.id);
    const before = await localCard(a, cardId);
    expect(before.reps).toBe(4);
    await syncRound(a); await syncRound(b); await syncRound(a);
    const srv = server.tableOf("eng_cards").get(cardId)!;
    const srvLa = server.tableOf("eng_review_logs").get(la.id)!;
    const afterA = await localCard(a, cardId);
    const afterLaOnA = await localLog(a, la.id);
    console.log(`R9I-1 skew ${skewMs}: server reps ${srv.reps} last ${srv.last_review_at} (La ${la.reviewedAt}, La2 ${la2.reviewedAt}); server La deleted_at ${srvLa.deleted_at ?? null}; A card last ${afterA.lastReviewAt}; A La deletedAt ${afterLaOnA?.deletedAt ?? null}`);
    expect(srvLa.deleted_at ?? null).not.toBeNull();
    expect(Date.parse(String(srv.last_review_at))).toBe(Date.parse(String(la2.reviewedAt)));
    expect(srv).toMatchObject({ reps: 4, stability: before.stability, leech: before.leech });
    await expectSnapshotConverged([a, b], server, cardId, await reviewIds([a, b]), 4, [la.id], false);
  });
});

describe.each([0, 5000, -5000])("R9I-2 synced undo then later review next to a live sibling (skew %i)", (skewMs) => {
  it("after the accepted undo, every later review of the card must advance the server card", async () => {
    const { a, b, server, cardId, la } = await concurrentBranch(skewMs);
    server.advance(10000);
    expect((await a.run(() => a.repo.cards.undoLastReview())).ok).toBe(true);
    await syncRound(a); await syncRound(b); await syncRound(a);
    expect(server.tableOf("eng_cards").get(cardId)?.reps).toBe(3); // undo accepted (test D)
    expect(server.tableOf("eng_review_logs").get(la.id)?.deleted_at ?? null).not.toBeNull();
    const repsSeen: number[] = [];
    for (let i = 0; i < 3; i++) {
      server.advance(10000);
      const dev = i % 2 === 0 ? a : b;
      await reviewMore(dev, cardId, 1);
      await syncRound(dev); await syncRound(a); await syncRound(b);
      repsSeen.push(Number(server.tableOf("eng_cards").get(cardId)?.reps));
    }
    const live = [...server.tableOf("eng_review_logs").values()].filter((l) => l.deleted_at == null).length;
    console.log(`R9I-2 skew ${skewMs}: server reps after three later reviews ${JSON.stringify(repsSeen)}; live server logs ${live}; A reps ${(await localCard(a, cardId)).reps}; B reps ${(await localCard(b, cardId)).reps}`);
    expect(repsSeen).toEqual([4, 5, 6]);
    await expectSnapshotConverged([a, b], server, cardId, await reviewIds([a, b]), 6, [la.id], false);
  });
});
