import { normalizeWord } from "../repository";
import ngslLemmas from "./ngsl-1.2.json";

/**
 * NGSL 1.2 (New General Service List) in rank order, rank 1 = most frequent lemma.
 * Source and licence: docs/lisanslar.md. The stats screen uses the rank to show how much of the
 * core 2,809 words a learner already knows, so the learner sees progress against a fixed goal.
 */
const lemmas: readonly string[] = ngslLemmas;

export const NGSL_SIZE = lemmas.length;

// Built once at load. Rank is stored 1-based because that is how the list is published.
const rankByLemma = new Map<string, number>();
lemmas.forEach((lemma, index) => {
  const key = normalizeWord(lemma);
  // The first entry wins if a lemma ever repeats, because the lower rank is the real one.
  if (!rankByLemma.has(key)) rankByLemma.set(key, index + 1);
});

/**
 * 1-based NGSL rank of a word, or null when it is not on the list. Uses the same normalisation
 * as saved words (trim, lower case, curly apostrophes, single spaces), so a saved "Walk " and
 * the list entry "walk" meet on the same key. Inflected forms ("walked") are not lemmas and
 * return null; the caller should pass the lemma.
 */
export function rankOf(lemma: string): number | null {
  return rankByLemma.get(normalizeWord(lemma)) ?? null;
}
