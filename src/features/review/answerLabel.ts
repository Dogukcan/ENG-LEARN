import type { Prompt } from "../../data";

/**
 * Text for the "correct answer" line after a card is checked.
 * Why the blanked form: for "She ____ to school" the sentence needed "walked", so showing only the
 * lemma "walk" would not explain what the blank was. When the form differs from the lemma we show
 * both: "walked (walk)". Only cloze prompts blank a form; the other kinds show the lemma.
 */
export function answerLabel(prompt: Prompt): string {
  if (prompt.kind === "cloze") {
    const lemma = prompt.answer.toLowerCase();
    // The first blanked form wins; it is the one the learner met first in the sentence.
    const form = prompt.accepted.find((accepted) => accepted !== lemma);
    // If the sentence held the lemma itself (accepted[0] === lemma) there is nothing extra to show.
    if (form && !prompt.accepted.includes(lemma)) return `${form} (${prompt.answer})`;
  }
  return prompt.answer;
}
