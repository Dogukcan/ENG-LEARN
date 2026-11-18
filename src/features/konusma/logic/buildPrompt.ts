import { ERROR_CATEGORY_IDS, type ErrorCategory } from "./errorCategories";
import type { Scenario } from "./scenarios";

export type Level = "A2" | "B1" | "B2" | "C1";

export interface BuildPromptInput {
  level?: Level;
  scenario: Scenario;
  targetWords: readonly string[];
  trackedCategories: readonly ErrorCategory[];
}

// The exact JSON shape is embedded in the prompt so the AI copies it; parseReport
// validates the same shape. Keep this in sync with reportSchema.ts.
const REPORT_FORMAT = `{
  "errors": [
    { "original": "I go to school yesterday", "corrected": "I went to school yesterday", "category": "tense-aspect", "note": "optional short note" }
  ],
  "betterPhrases": [
    { "original": "very tired", "better": "exhausted" }
  ],
  "newWords": [
    { "word": "exhausted", "sentence": "optional example sentence", "meaningTr": "optional Turkish meaning" }
  ],
  "summary": "optional one or two sentence summary"
}`;

export function buildPrompt(input: BuildPromptInput): string {
  const level = input.level ?? "B1";
  const { scenario, targetWords, trackedCategories } = input;

  const tasks = scenario.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const words = targetWords.length > 0 ? targetWords.join(", ") : "(none)";
  const tracked = trackedCategories.length > 0 ? trackedCategories.join(", ") : "(none)";

  return `You are my English speaking partner. My level is ${level}. Speak naturally at that level.

Scenario: ${scenario.title}
Tasks (we do them in order):
${tasks}
End condition: ${scenario.endCondition}

Target words I want to use during the conversation: ${words}
Encourage me to use them, but do not force them.

Error categories I am tracking: ${tracked}
Allowed category ids for the report: ${ERROR_CATEGORY_IDS.join(", ")}

Rules:
- Do not interrupt every sentence to correct me. Let the conversation flow.
- When I make a mistake in a tracked category, point at the error first and let me correct it myself. Only after that, give me the correct form.
- Do not end every reply with a question. Sometimes just react or add your own thought.
- Close the session after the 3 tasks are done.
- After closing, output ONLY a JSON report in exactly the format below. No text before or after it. Use only the allowed category ids.

Report format:
${REPORT_FORMAT}

Start now with the first task.`;
}
