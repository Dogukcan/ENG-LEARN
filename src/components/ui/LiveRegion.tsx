import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export interface LiveRegionProps {
  /** Text to announce. Change it to trigger an announcement; "" announces nothing. */
  children?: ReactNode;
  /** Show the text on screen too (small muted line). Default: hidden visually, still announced. */
  visible?: boolean;
  className?: string;
}

/**
 * Polite live region: screen readers read changes to its text without moving focus,
 * for example "Kelime eklendi" after a quick capture.
 *
 * Rule: mount it EARLY and keep it mounted, only change its text. A region that appears together
 * with its text is often not announced. aria-atomic reads the whole message, not just the diff.
 */
export function LiveRegion({ children, visible = false, className }: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cx(visible ? "text-small font-medium leading-[1.3] text-muted" : "sr-only", className)}
    >
      {children}
    </div>
  );
}
