import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Inner spacing: "none" for list panels whose rows own their padding, "sm" 16px, "md" 24px. */
  padding?: "none" | "sm" | "md";
  /** Which element to render. A <section> should get an aria-label or heading. */
  as?: "div" | "section" | "article";
  /** Clip children to the rounded corners (needed when rows have their own background). */
  clip?: boolean;
  children?: ReactNode;
}

// Full literal class strings, so Tailwind can find them when it scans the source.
const PADDING = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
} as const;

/**
 * White surface with radius 20. Pure presentation: no behaviour, so it is a good first
 * example of composition: screens put any children inside and the Panel only supplies the look.
 */
export function Panel({
  padding = "md",
  as: Tag = "div",
  clip = false,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag
      className={cx("rounded-card bg-surface text-text", PADDING[padding], clip && "overflow-hidden", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
