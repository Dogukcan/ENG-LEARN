import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../data";
import { answerLabel } from "./answerLabel";

describe("answerLabel", () => {
  it("shows the blanked form with the lemma when they differ", () => {
    const prompt = buildPrompt({ lemma: "walk", sentence: "She walked to school.", meaningTr: undefined, alternatives: undefined });
    expect(answerLabel(prompt)).toBe("walked (walk)");
  });
  it("shows only the lemma when the sentence used the lemma", () => {
    const prompt = buildPrompt({ lemma: "walk", sentence: "I walk to school.", meaningTr: undefined, alternatives: undefined });
    expect(answerLabel(prompt)).toBe("walk");
  });
  it("shows the lemma for meaning and recall prompts", () => {
    expect(answerLabel(buildPrompt({ lemma: "walk", sentence: undefined, meaningTr: "yürümek", alternatives: undefined }))).toBe("walk");
    expect(answerLabel(buildPrompt({ lemma: "walk", sentence: undefined, meaningTr: undefined, alternatives: undefined }))).toBe("walk");
  });
});
