import { describe, expect, it } from "vitest";
import { buildPrompt, checkAnswer } from "../srs/prompt";

describe("buildPrompt", () => {
  it("makes a cloze from the sentence, case-insensitive, with the meaning as hint", () => {
    expect(
      buildPrompt({ lemma: "anchor", sentence: "The Anchor was heavy.", meaningTr: "çapa" }),
    ).toEqual({ kind: "cloze", text: "The ____ was heavy.", answer: "anchor", hint: "çapa" });
  });

  it("has no hint when there is no meaning", () => {
    expect(buildPrompt({ lemma: "anchor", sentence: "An anchor." })).toEqual({
      kind: "cloze",
      text: "An ____.",
      answer: "anchor",
    });
  });

  it.each([
    ["walk", "She walks home.", "She ____ home."],
    ["walk", "He walked home.", "He ____ home."],
    ["walk", "I was walking home.", "I was ____ home."],
    ["love", "They loved it.", "They ____ it."],
    ["watch", "He watches TV.", "He ____ TV."],
  ])("blanks inflections of %s in %j", (lemma, sentence, expected) => {
    expect(buildPrompt({ lemma, sentence })).toMatchObject({ kind: "cloze", text: expected });
  });

  it("blanks every occurrence but never a part of another word", () => {
    expect(buildPrompt({ lemma: "art", sentence: "Art at the party is art." })).toMatchObject({
      text: "____ at the party is ____.",
    });
  });

  it("does not treat regex characters in the word as a pattern", () => {
    expect(buildPrompt({ lemma: "c++", sentence: "I like c++ a lot." })).toMatchObject({
      kind: "cloze",
    });
  });

  it("asks for the English word when there is only a Turkish meaning", () => {
    expect(buildPrompt({ lemma: "anchor", meaningTr: "çapa" })).toEqual({
      kind: "meaning",
      text: "Türkçesi: çapa",
      answer: "anchor",
    });
  });

  it("falls back to the meaning when the sentence does not contain the word", () => {
    expect(buildPrompt({ lemma: "go", sentence: "She went home.", meaningTr: "gitmek" })).toMatchObject({
      kind: "meaning",
    });
  });

  it("shows the word itself for self-grading when there is nothing else", () => {
    expect(buildPrompt({ lemma: "anchor" })).toEqual({
      kind: "recall",
      text: "anchor",
      answer: "anchor",
    });
  });
});

describe("checkAnswer", () => {
  it("ignores case and outer spaces", () => {
    expect(checkAnswer("  Anchor ", { lemma: "anchor" })).toBe(true);
    expect(checkAnswer("anchors", { lemma: "anchor" })).toBe(false);
    expect(checkAnswer("   ", { lemma: "anchor" })).toBe(false);
  });

  it("accepts listed alternatives such as harbour for harbor", () => {
    const word = { lemma: "harbor", alternatives: ["harbour"] };
    expect(checkAnswer("Harbour", word)).toBe(true);
    expect(checkAnswer("harbor", word)).toBe(true);
    expect(checkAnswer("harbr", word)).toBe(false);
  });
});
