import { describe, expect, it } from "vitest";
import { buildPrompt, checkAnswer } from "../srs/prompt";

describe("buildPrompt", () => {
  it("makes a cloze from the sentence, case-insensitive, with the meaning as hint", () => {
    expect(
      buildPrompt({ lemma: "anchor", sentence: "The Anchor was heavy.", meaningTr: "çapa" }),
    ).toEqual({ kind: "cloze", text: "The ____ was heavy.", answer: "anchor", accepted: ["anchor"], hint: "çapa" });
  });

  it("has no hint when there is no meaning", () => {
    expect(buildPrompt({ lemma: "anchor", sentence: "An anchor." })).toEqual({
      kind: "cloze",
      text: "An ____.",
      answer: "anchor",
      accepted: ["anchor"],
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

describe("review fixes: inflected answers, apostrophes, alternatives, punctuation", () => {
  it("accepts the inflected form that was blanked, and still the lemma", () => {
    const word = { lemma: "walk", sentence: "She walked home." };
    expect(buildPrompt(word)).toMatchObject({ kind: "cloze", accepted: ["walked"] });
    expect(checkAnswer("walked", word)).toBe(true);
    expect(checkAnswer("Walked", word)).toBe(true);
    expect(checkAnswer("walk", word)).toBe(true);
    expect(checkAnswer("walking", word)).toBe(false);
  });

  it("builds a cloze for a curly apostrophe sentence and accepts either apostrophe", () => {
    const word = { lemma: "don't", sentence: "I don\u2019t know." };
    expect(buildPrompt(word)).toMatchObject({ kind: "cloze", text: "I ____ know." });
    expect(checkAnswer("don\u2019t", word)).toBe(true);
    expect(checkAnswer("don't", word)).toBe(true);
  });

  it("builds a cloze from an alternative spelling", () => {
    const word = { lemma: "harbor", alternatives: ["harbour"], sentence: "The harbour is busy." };
    expect(buildPrompt(word)).toMatchObject({ kind: "cloze", text: "The ____ is busy." });
    expect(checkAnswer("harbour", word)).toBe(true);
    expect(checkAnswer("harbor", word)).toBe(true);
  });

  it("tries the longest variant first", () => {
    const word = { lemma: "color", alternatives: ["colour"], sentence: "A colours chart." };
    expect(buildPrompt(word)).toMatchObject({ text: "A ____ chart." });
  });

  it("ignores outer punctuation and repeated inner spaces in the answer", () => {
    const word = { lemma: "grab a coffee" };
    expect(checkAnswer("grab  a   coffee", word)).toBe(true);
    expect(checkAnswer("grab a coffee.", word)).toBe(true);
    expect(checkAnswer("  \"Grab a coffee!\" ", word)).toBe(true);
    expect(checkAnswer("coffee.", { lemma: "coffee" })).toBe(true);
    expect(checkAnswer("...", { lemma: "coffee" })).toBe(false);
  });

  it("matches a phrase in the sentence across repeated spaces", () => {
    expect(buildPrompt({ lemma: "grab a coffee", sentence: "Let's grab  a coffee." })).toMatchObject({
      text: "Let's ____.",
    });
  });
});
