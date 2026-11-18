import { describe, expect, it } from "vitest";
import { buildPrompt } from "./buildPrompt";
import { ERROR_CATEGORY_IDS, ERROR_CATEGORY_LABELS } from "./errorCategories";
import { parseReport } from "./reportSchema";
import { SCENARIOS } from "./scenarios";

const validReport = {
  errors: [{ original: "he go", corrected: "he goes", category: "subject-verb-agreement" }],
  betterPhrases: [{ original: "very tired", better: "exhausted" }],
  newWords: [{ word: "exhausted", meaningTr: "bitkin" }],
  summary: "Good job.",
};

describe("scenarios and categories", () => {
  it("has 4 scenarios with 3 tasks each", () => {
    expect(SCENARIOS).toHaveLength(4);
    for (const s of SCENARIOS) expect(s.tasks).toHaveLength(3);
  });
  it("has a Turkish label for every category", () => {
    for (const id of ERROR_CATEGORY_IDS) expect(ERROR_CATEGORY_LABELS[id]).toBeTruthy();
  });
});

describe("buildPrompt", () => {
  const scenario = SCENARIOS[1]!;
  const prompt = buildPrompt({
    scenario,
    targetWords: ["exhausted", "reluctant"],
    trackedCategories: ["article", "preposition"],
  });
  it("defaults to B1 and includes tasks, words and tracked categories", () => {
    expect(prompt).toContain("level is B1");
    for (const t of scenario.tasks) expect(prompt).toContain(t);
    expect(prompt).toContain("exhausted, reluctant");
    expect(prompt).toContain("tracking: article, preposition");
  });
  it("contains the behaviour rules and the JSON format", () => {
    expect(prompt).toContain("Do not interrupt every sentence");
    expect(prompt).toContain("Do not end every reply with a question");
    expect(prompt).toContain("output ONLY a JSON report");
    expect(prompt).toContain('"betterPhrases"');
    expect(prompt).toContain('"newWords"');
  });
  it("uses a custom level", () => {
    expect(buildPrompt({ level: "C1", scenario, targetWords: [], trackedCategories: [] })).toContain("level is C1");
  });
});

describe("parseReport", () => {
  const json = JSON.stringify(validReport);
  it("parses raw JSON", () => {
    expect(parseReport(json)).toEqual({ ok: true, report: validReport });
  });
  it("parses a fenced block", () => {
    const r = parseReport("```json\n" + json + "\n```");
    expect(r.ok).toBe(true);
  });
  it("parses JSON surrounded by text", () => {
    const r = parseReport("Here is your report:\n" + json + "\nHope it helps!");
    expect(r.ok).toBe(true);
  });
  it("rejects broken JSON", () => {
    const r = parseReport('{"errors": [');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^JSON okunamadı: /);
  });
  it("rejects empty text", () => {
    expect(parseReport("  ")).toEqual({ ok: false, message: "JSON okunamadı: metin boş." });
  });
  it("reports a missing field", () => {
    const r = parseReport(JSON.stringify({ errors: [], newWords: [] }));
    expect(r).toEqual({ ok: false, message: "betterPhrases eksik: bu alan zorunlu." });
  });
  it("reports a bad category with its index", () => {
    const bad = {
      ...validReport,
      errors: [validReport.errors[0], validReport.errors[0], { original: "a", corrected: "b", category: "grammar" }],
    };
    const r = parseReport(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^errors\[2\]\.category geçersiz: /);
  });
});
