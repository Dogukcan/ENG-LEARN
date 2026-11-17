/**
 * Joins class names and skips falsy values.
 *
 * Why not a library: we only need "join the truthy strings", which is three lines.
 * Tailwind scans source files for complete class-name strings, so every class used with
 * cx() must appear as a full literal string somewhere (never built with template strings
 * like `bg-${block}-mark`, or Tailwind will not generate the CSS for it).
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** The four learning blocks. Each owns a hue (identity and data only, see ui-freeze.md). */
export type Block = "okuma" | "kelime" | "dinleme" | "konusma";
