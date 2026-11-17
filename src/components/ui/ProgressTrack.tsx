import type { Block } from "./cx.ts";
import { cx } from "./cx.ts";

export interface ProgressTrackProps {
  /** Current amount, for example 3 reviewed cards. */
  value: number;
  /** Total amount, for example 10. Defaults to 100 so `value` can be a percentage. */
  max?: number;
  /** Track thickness: "sm" = 6px (review session), "md" = 12px (day strip). */
  size?: "sm" | "md";
  /** Fill hue from the block "mark" tokens. */
  block?: Block;
  /** What is being measured, read aloud by screen readers ("Kart ilerlemesi"). Required. */
  label: string;
  /** Human wording for the value, for example "3 / 10 kart". Better than a bare number. */
  valueText?: string;
  className?: string;
}

const FILL: Record<Block, string> = {
  okuma: "bg-okuma-mark",
  kelime: "bg-kelime-mark",
  dinleme: "bg-dinleme-mark",
  konusma: "bg-konusma-mark",
};

/**
 * A progress bar. The grey track is always visible and the coloured fill grows over it.
 * It carries role="progressbar" with aria-valuenow/min/max, because a plain <div> with a width
 * means nothing to assistive technology.
 */
export function ProgressTrack({
  value,
  max = 100,
  size = "sm",
  block = "kelime",
  label,
  valueText,
  className,
}: ProgressTrackProps) {
  // Clamp so a bad input (negative, or above max) can never draw outside the track.
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cx(
        "w-full overflow-hidden bg-track-empty",
        size === "sm" ? "h-1.5 rounded-[3px]" : "h-3 rounded-md",
        className,
      )}
    >
      {/* Width is the one truly dynamic value, so it is an inline style; colour stays a class. */}
      <div
        className={cx("h-full transition-[width] duration-180", FILL[block])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
