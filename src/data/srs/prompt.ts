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
 * The lookarounds stop it from hitting the word inside another word ("art" in "party"). They
 * are used instead of `\b` because `\b` fails next to a non-letter, e.g. for a word like "c++".
 * The longest endings are tried first so "walking" is blanked as one piece.
 */
function blankWord(sentence: string, lemma: string): string {
  const pattern = new RegExp(
    `(?<!\\p{L})${escapeRegExp(lemma)}(?:ing|es|ed|s|d)?(?!\\p{L})`,
    "giu",
  );
  return sentence.replace(pattern, BLANK);
}

export function buildPrompt(word: PromptWord): Prompt {
  const sentence = word.sentence?.trim();
  const meaning = word.meaningTr?.trim();

  if (sentence) {
    const text = blankWord(sentence, word.lemma);
    // If the word never appears in the sentence (for example an irregular form like
    // "went" for "go"), a cloze would show nothing to fill in, so fall through to the
    // other prompt types instead of showing a sentence with no blank.
    if (text !== sentence) {
      const prompt: Prompt = { kind: "cloze", text, answer: word.lemma };
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
 * Is the typed text a correct answer? Outer spaces and letter case are ignored. Words with an
 * `alternatives` list also accept those spellings (harbor / harbour).
 */
export function checkAnswer(input: string, word: PromptWord): boolean {
  const typed = normalizeWord(input);
  if (!typed) return false;
  const accepted = [word.lemma, ...(word.alternatives ?? [])].map(normalizeWord);
  return accepted.includes(typed);
}
