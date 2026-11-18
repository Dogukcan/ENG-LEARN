import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createIndexedDbRepository } from "../indexeddb";
import type { NewVideo } from "../repository";

const freshName = () => `eng-learn-video-test-${crypto.randomUUID()}`;
const video = (id: string, over: Partial<NewVideo> = {}): NewVideo => ({
  youtubeId: id,
  title: `Title ${id}`,
  channel: "Channel",
  level: "orta",
  durationMinutes: 12,
  ...over,
});

describe("videos", () => {
  it("adds a video as todo and lists it; the same YouTube id is a typed failure", async () => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.videos.add(video("aaaaaaaaaaa"));
    expect(added).toMatchObject({ ok: true, video: { status: "todo", youtubeId: "aaaaaaaaaaa", durationMinutes: 12 } });
    expect(await repo.videos.add(video("aaaaaaaaaaa", { title: "Other" }))).toEqual({ ok: false, reason: "duplicate" });
    expect(await repo.videos.listByStatus("todo")).toHaveLength(1);
    expect(await repo.videos.listByStatus("watched")).toEqual([]);
    // The hidden unique key never leaks into the public object.
    expect(added.ok && "youtubeKey" in added.video).toBe(false);
  });

  it("rejects programming mistakes by throwing", async () => {
    const repo = createIndexedDbRepository(freshName());
    await expect(repo.videos.add(video("  "))).rejects.toThrow(RangeError);
    await expect(repo.videos.add(video("bbbbbbbbbbb", { durationMinutes: 0 }))).rejects.toThrow(RangeError);
    await expect(repo.videos.add(video("bbbbbbbbbbb", { durationMinutes: 1.5 }))).rejects.toThrow(RangeError);
  });

  it("lists todo oldest first and watched most recent first", async () => {
    const repo = createIndexedDbRepository(freshName());
    const first = await repo.videos.add(video("aaaaaaaaaaa"));
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct createdAt values
    const second = await repo.videos.add(video("bbbbbbbbbbb"));
    if (!first.ok || !second.ok) throw new Error("add failed");
    expect((await repo.videos.listByStatus("todo")).map((v) => v.id)).toEqual([first.video.id, second.video.id]);
    await repo.videos.markWatched(first.video.id, "az", new Date(2026, 10, 17, 10, 0));
    await repo.videos.markWatched(second.video.id, "cogu", new Date(2026, 10, 17, 11, 0));
    expect((await repo.videos.listByStatus("watched")).map((v) => v.youtubeId)).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa"]);
  });

  it("markWatched writes the video and a dinleme activity log together", async () => {
    const name = freshName();
    const repo = createIndexedDbRepository(name);
    const added = await repo.videos.add(video("aaaaaaaaaaa", { durationMinutes: 12 }));
    if (!added.ok) throw new Error("add failed");
    const at = new Date(2026, 10, 17, 21, 30);
    const result = await repo.videos.markWatched(added.video.id, "yarisi", at);
    expect(result).toMatchObject({
      ok: true,
      video: { status: "watched", understanding: "yarisi", watchedAt: at.toISOString() },
    });
    const logs = await repo.activity.listForDay("2026-11-17");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ block: "dinleme", seconds: 720, source: "manual", startedAt: at.toISOString() });
    expect(await repo.activity.minutesPerBlockForDay("2026-11-17")).toMatchObject({ dinleme: 12 });
    expect(await repo.videos.markWatched(added.video.id)).toEqual({ ok: false, reason: "already-watched" });
    expect(await repo.videos.markWatched("nope")).toEqual({ ok: false, reason: "not-found" });
    expect(await repo.activity.listForDay("2026-11-17")).toHaveLength(1); // no second log
  });

  it("markWatched is all-or-nothing: an error after the first write leaves the video todo", async () => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.videos.add(video("aaaaaaaaaaa"));
    if (!added.ok) throw new Error("add failed");
    // An invalid date makes toISOString throw inside the transaction.
    await expect(repo.videos.markWatched(added.video.id, "az", new Date("invalid"))).rejects.toThrow(RangeError);
    expect((await repo.videos.listByStatus("todo")).map((v) => v.id)).toEqual([added.video.id]);
    expect(await repo.videos.listByStatus("watched")).toEqual([]);
  });

  it("undoWatched makes the video todo again and removes exactly its minutes", async () => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.videos.add(video("aaaaaaaaaaa"));
    if (!added.ok) throw new Error("add failed");
    await repo.activity.add({ block: "dinleme", startedAt: new Date(2026, 10, 17, 8).toISOString(), seconds: 300, source: "manual" });
    await repo.videos.markWatched(added.video.id, "az", new Date(2026, 10, 17, 9));
    expect(await repo.activity.listForDay("2026-11-17")).toHaveLength(2);

    const undone = await repo.videos.undoWatched(added.video.id);
    expect(undone.ok && undone.video.status).toBe("todo");
    expect(undone.ok && "watchedAt" in undone.video).toBe(false);
    expect(undone.ok && "understanding" in undone.video).toBe(false);
    const logs = await repo.activity.listForDay("2026-11-17");
    expect(logs.map((l) => l.seconds)).toEqual([300]); // the unrelated log stays
    expect(await repo.videos.undoWatched(added.video.id)).toEqual({ ok: false, reason: "not-watched" });
    expect(await repo.videos.undoWatched("nope")).toEqual({ ok: false, reason: "not-found" });
    // The removal is visible to sync as a soft delete.
    const changed = await repo.sync.listChangedSince("activity", "1970-01-01T00:00:00.000Z");
    expect(changed.filter((r) => r.deletedAt !== undefined)).toHaveLength(1);
  });

  it("remove is a soft delete: it frees the YouTube id and keeps logged minutes", async () => {
    const repo = createIndexedDbRepository(freshName());
    const added = await repo.videos.add(video("aaaaaaaaaaa"));
    if (!added.ok) throw new Error("add failed");
    await repo.videos.markWatched(added.video.id, undefined, new Date(2026, 10, 17, 9));
    const removed = await repo.videos.remove(added.video.id);
    expect(removed?.id).toBe(added.video.id);
    expect(await repo.videos.listByStatus("watched")).toEqual([]);
    expect(await repo.videos.remove(added.video.id)).toBeUndefined();
    expect(await repo.activity.listForDay("2026-11-17")).toHaveLength(1);
    expect((await repo.videos.add(video("aaaaaaaaaaa"))).ok).toBe(true);
    expect(await repo.videos.markWatched(added.video.id)).toEqual({ ok: false, reason: "not-found" });
    const rows = await repo.sync.listChangedSince("videos", "1970-01-01T00:00:00.000Z");
    expect(rows.some((r) => r.id === added.video.id && typeof r.deletedAt === "string")).toBe(true);
  });

  it("notifies subscribers after writes", async () => {
    const repo = createIndexedDbRepository(freshName());
    const listener = vi.fn();
    repo.subscribe(listener);
    const added = await repo.videos.add(video("aaaaaaaaaaa"));
    await repo.videos.add(video("aaaaaaaaaaa")); // duplicate: no notification
    expect(listener).toHaveBeenCalledTimes(1);
    if (added.ok) await repo.videos.markWatched(added.video.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
