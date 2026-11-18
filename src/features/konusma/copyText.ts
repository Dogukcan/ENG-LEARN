// Copies text to the clipboard with a fallback.
//
// Why two ways: `navigator.clipboard` only works on secure pages and can be blocked by the
// browser or by a permission prompt. The old `execCommand("copy")` on a hidden textarea still
// works in many of those cases. If both fail the caller shows the text and lets the learner copy it by hand.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked or denied: fall through to the textarea trick.
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // readonly keeps the iOS keyboard from opening; fixed + transparent keeps the page from jumping.
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/** Selects all text inside an element, so the learner only has to press "Copy" in the system menu. */
export function selectElementText(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
