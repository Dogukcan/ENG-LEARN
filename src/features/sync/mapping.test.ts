import { describe, expect, it } from "vitest";
import { SYNC_STORES } from "../../data";
import type { SyncRow } from "../../data";
import { SYNC_ORDER, TABLES, camelToSnake, fromRemoteRow, toRemoteRow } from "./mapping";

describe("camelToSnake", () => {
  it("converts column names", () => {
    expect(camelToSnake("meaningTr")).toBe("meaning_tr");
    expect(camelToSnake("stabilityFast")).toBe("stability_fast");
    expect(camelToSnake("title")).toBe("title");
  });
});

describe("tables", () => {
  it("cover every synced store exactly once, in a fixed order", () => {
    expect([...SYNC_ORDER].sort()).toEqual([...SYNC_STORES].sort());
    expect(Object.keys(TABLES).sort()).toEqual([...SYNC_STORES].sort());
    expect(SYNC_ORDER[0]).toBe("books");
    expect(SYNC_ORDER[SYNC_ORDER.length - 1]).toBe("speakingErrors");
  });
});

describe("toRemoteRow", () => {
  const inbox: SyncRow = {
    id: "i1",
    word: "  Colour ",
    source: { kind: "kitap", bookId: "b1", page: 4 },
    createdAt: "2026-11-17T07:00:00.000Z",
    updatedAt: "2026-11-17T07:00:01.000Z",
  };

  it("uses snake_case columns, fills normalized, and does not send updated_at or user_id", () => {
    const out = toRemoteRow("inbox", inbox);
    expect(out).toMatchObject({ id: "i1", word: "  Colour ", normalized: "colour", created_at: inbox.createdAt });
    expect(out).not.toHaveProperty("updated_at");
    expect(out).not.toHaveProperty("user_id");
  });

  it("keeps nested objects as they are (jsonb)", () => {
    expect(toRemoteRow("inbox", inbox).source).toEqual({ kind: "kitap", bookId: "b1", page: 4 });
  });

  it("sends null for empty nullable fields so a cleared value reaches the server", () => {
    const out = toRemoteRow("inbox", inbox);
    expect(out.sentence).toBeNull();
    expect(out.previous_status).toBeNull();
    expect(out.deleted_at).toBeNull();
  });

  it("fills normalized for words from the lemma", () => {
    const out = toRemoteRow("words", { id: "w1", lemma: "Don’t", status: "learning", source: { kind: "diger" }, createdAt: "x", updatedAt: "y" });
    expect(out.normalized).toBe("don't");
  });

  it("sends deleted_at for a soft-deleted row", () => {
    const out = toRemoteRow("books", { id: "b", title: "t", shortName: "RW1", unit: 1, page: 1, updatedAt: "u", deletedAt: "2026-11-17T08:00:00.000Z" });
    expect(out.deleted_at).toBe("2026-11-17T08:00:00.000Z");
  });

  it("sends the local edit time as client_updated_at (the server only compares it, it is not the row time)", () => {
    expect(toRemoteRow("inbox", inbox)).toMatchObject({ client_updated_at: inbox.updatedAt });
    expect(toRemoteRow("inbox", inbox)).not.toHaveProperty("updated_at");
  });

  it("uses the account's user id as the settings id, so two accounts never share a primary key", () => {
    expect(toRemoteRow("settings", { id: "app", updatedAt: "u" }, "user-1").id).toBe("user-1");
    expect(toRemoteRow("settings", { id: "app", updatedAt: "u" }, "user-2").id).toBe("user-2");
    // Other stores keep their own id.
    expect(toRemoteRow("books", { id: "b1", title: "t", shortName: "RW1", unit: 1, page: 1, updatedAt: "u" }, "user-1").id).toBe("b1");
  });

  it("leaves a missing required settings field out so the column default applies", () => {
    const out = toRemoteRow("settings", { id: "app", updatedAt: "u", newCardLimit: 12 });
    expect(out).toMatchObject({ id: "app", new_card_limit: 12, active_book_id: null });
    expect(out).not.toHaveProperty("daily_target_minutes");
  });
});

describe("fromRemoteRow", () => {
  it("maps the settings row of an account back to the local id \"app\"", () => {
    expect(fromRemoteRow("settings", { id: "user-1", updated_at: "2026-11-17T07:00:00+00:00", deleted_at: null }).id).toBe("app");
  });

  it("returns camelCase fields, drops user_id and keeps jsonb contents untouched", () => {
    const out = fromRemoteRow("speakingSessions", {
      id: "s1",
      user_id: "u",
      scenario_id: "cafe",
      started_at: "2026-11-17T07:00:00+00:00",
      raw_report: { errors: [], betterPhrases: [], newWords: [] },
      created_at: "2026-11-17T07:00:00+00:00",
      updated_at: "2026-11-17T07:00:00.123456+00:00",
      deleted_at: null,
    });
    expect(out).toMatchObject({ id: "s1", scenarioId: "cafe", startedAt: "2026-11-17T07:00:00+00:00", updatedAt: "2026-11-17T07:00:00.123456+00:00", deletedAt: null });
    expect(out.rawReport).toEqual({ errors: [], betterPhrases: [], newWords: [] });
    expect(out).not.toHaveProperty("user_id");
    expect(out).not.toHaveProperty("normalized");
  });
});
