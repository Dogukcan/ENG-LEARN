import { z } from "zod";
import { ERROR_CATEGORY_IDS } from "./errorCategories";

// Shape of the JSON report the external AI returns at the end of a session.
// Category is a strict enum on purpose: an unknown category must be rejected,
// not silently mapped, so the user sees that the AI broke the format.
export const reportSchema = z.object({
  errors: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      category: z.enum(ERROR_CATEGORY_IDS),
      note: z.string().optional(),
    }),
  ),
  betterPhrases: z.array(z.object({ original: z.string(), better: z.string() })),
  newWords: z.array(
    z.object({
      word: z.string(),
      sentence: z.string().optional(),
      meaningTr: z.string().optional(),
    }),
  ),
  summary: z.string().optional(),
});

export type SessionReport = z.infer<typeof reportSchema>;

export type ParseReportResult = { ok: true; report: SessionReport } | { ok: false; message: string };

// Turns a zod path like ["errors", 2, "category"] into "errors[2].category".
function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || "rapor";
}

// Tries, in order: the raw text, a ```json fence, then the outermost {...} block.
// Chat apps often wrap the JSON in prose or a code fence even when told not to.
function extractCandidates(text: string): string[] {
  const candidates: string[] = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  return candidates;
}

export function parseReport(text: string): ParseReportResult {
  if (text.trim() === "") return { ok: false, message: "JSON okunamadı: metin boş." };

  let parsed: unknown;
  let parseError = "";
  let found = false;
  for (const candidate of extractCandidates(text)) {
    try {
      parsed = JSON.parse(candidate);
      found = true;
      break;
    } catch (err) {
      if (!parseError) parseError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!found) return { ok: false, message: `JSON okunamadı: ${parseError}` };

  const result = reportSchema.safeParse(parsed);
  if (result.success) return { ok: true, report: result.data };

  const issue = result.error.issues[0];
  if (!issue) return { ok: false, message: "Rapor geçersiz." };
  const path = formatPath(issue.path);
  if (issue.code === "invalid_value") {
    const allowed = ERROR_CATEGORY_IDS.join(", ");
    return { ok: false, message: `${path} geçersiz: izin verilen değerler ${allowed}.` };
  }
  if (issue.message.includes("received undefined")) {
    return { ok: false, message: `${path} eksik: bu alan zorunlu.` };
  }
  return { ok: false, message: `${path} geçersiz: ${issue.message}` };
}
