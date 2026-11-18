// What the review screen shows for a card, as pure functions (no database, easy to test).
//
// Three situations, from most to least helpful for memory:
// 1. A sentence exists: show it with the word blanked out (a "cloze"). Recalling a word inside
//    its own context is the strongest cue, and it is the way the user met the word.
// 2. Only a Turkish meaning exists: show the meaning and ask for the English word.
// 3. Nothing else: show the word and let the user judge themselves whether they know it.

import { normalizeWord } from "../repository";
import type { Word } from "../types";

/** Word fields the prompt needs. `alternatives` holds spelling variants such as harbor/harbour. */
export type PromptWord = Pick<Word, "lemma" | "sentence" | "meaningTr" | "alternatives">;

export type Prompt =
  | {
      kind: "cloze";
      /** The sentence with the word replaced by "____". */
      text: string;
      /** The word to type. */
      answer: string;
      /**
       * The exact forms that were blanked in the sentence ("walked"), so typing the form the
       * sentence needs counts as correct, not only the base word.
       */
      accepted: string[];
      hint?: string;
    }
  | {
      kind: "meaning";
      text: string;
      answer: string;
    }
  | {
      /** Self-grade only: the user does not type anything. */
      kind: "recall";
      text: string;
      answer: string;
    };

const BLANK = "____";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Blank out the word in the sentence, ignoring case, and also its simple inflections:
 * word + s / es / ed / ing / d ("walk" -> walks, walked, walking; "love" -> loves, loved).
 * The lemma and every spelling variant are matched together, longest first, so "harbour" is not
 * cut short by "harbo..." style prefixes of another variant. Apostrophes match both the straight
 * and the curly form, and a space in a phrase matches any run of spaces.
 * The lookarounds stop it from hitting the word inside another word ("art" in "party"). They
 * are used instead of `\b` because `\b` fails next to a non-letter, e.g. for a word like "c++".
 * The longest endings are tried first so "walking" is blanked as one piece.
 * Returns the blanked text and the forms that were actually found in the sentence.
 */
function blankWord(
  sentence: string,
  forms: readonly string[],
): { text: string; matched: string[] } {
  const variants = [...new Set(forms.map(normalizeWord).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((form) =>
      escapeRegExp(form).replace(/'/g, "['\u2018\u2019\u02BC]").replace(/ /g, "\\s+"),
    );
  if (variants.length === 0) return { text: sentence, matched: [] };
  const pattern = new RegExp(
    `(?<!\\p{L})(?:${variants.join("|")})(?:ing|es|ed|s|d)?(?!\\p{L})`,
    "giu",
  );
  const matched: string[] = [];
  const text = sentence.replace(pattern, (found) => {
    matched.push(found);
    return BLANK;
  });
  return { text, matched };
}

export function buildPrompt(word: PromptWord): Prompt {
  const sentence = word.sentence?.trim();
  const meaning = word.meaningTr?.trim();

  if (sentence) {
    const { text, matched } = blankWord(sentence, [word.lemma, ...(word.alternatives ?? [])]);
    // If the word never appears in the sentence (for example an irregular form like
    // "went" for "go"), a cloze would show nothing to fill in, so fall through to the
    // other prompt types instead of showing a sentence with no blank.
    if (text !== sentence) {
      const accepted = [...new Set(matched.map(normalizeWord))];
      const prompt: Prompt = { kind: "cloze", text, answer: word.lemma, accepted };
      if (meaning) prompt.hint = meaning;
      return prompt;
    }
  }
  if (meaning) {
    return { kind: "meaning", text: `Türkçesi: ${meaning}`, answer: word.lemma };
  }
  return { kind: "recall", text: word.lemma, answer: word.lemma };
}

/**
 * Fold a typed or stored answer for comparison only (never used for the index key): normalize,
 * drop punctuation at the outer edges ("coffee." from a phone's double-space shortcut) and keep
 * inner apostrophes and hyphens. Falls back to the plain form if only punctuation is left, so a
 * lemma that is itself punctuation still matches.
 */
function foldAnswer(text: string): string {
  const plain = normalizeWord(text);
  const stripped = plain.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
  return stripped || plain;
}

/**
 * Is the typed text a correct answer? Letter case, outer spaces, outer punctuation and repeated
 * inner spaces are ignored. Words with an `alternatives` list also accept those spellings
 * (harbor / harbour), and the inflected form blanked in the cloze ("walked") is accepted too.
 */
export function checkAnswer(input: string, word: PromptWord): boolean {
  const typed = foldAnswer(input);
  if (!typed) return false;
  const accepted = [word.lemma, ...(word.alternatives ?? [])];
  const prompt = buildPrompt(word);
  if (prompt.kind === "cloze") accepted.push(...prompt.accepted);
  return accepted.map(foldAnswer).includes(typed);
}
