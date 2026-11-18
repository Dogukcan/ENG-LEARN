// Error categories the speaking bridge can track. The ids are English because they are
// part of the JSON contract with the external AI; the labels are what the learner sees.
export const ERROR_CATEGORY_IDS = [
  "article",
  "preposition",
  "tense-aspect",
  "word-order",
  "subject-verb-agreement",
  "word-choice",
  "pronunciation",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORY_IDS)[number];

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  article: "Tanım edatı (a, an, the)",
  preposition: "Edat (in, on, at ...)",
  "tense-aspect": "Zaman ve görünüş",
  "word-order": "Kelime sırası",
  "subject-verb-agreement": "Özne-fiil uyumu",
  "word-choice": "Kelime seçimi",
  pronunciation: "Telaffuz",
};

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === "string" && (ERROR_CATEGORY_IDS as readonly string[]).includes(value);
}
