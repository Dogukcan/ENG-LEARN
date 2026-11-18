import { useId } from "react";

export interface StepperProps {
  /** Visible label on the left, e.g. "Sayfa". The buttons are named "<label> azalt" / "<label> artır". */
  label: string;
  value: number;
  onStep: (delta: 1 | -1) => void;
}

const STEP_BUTTON =
  "inline-flex size-11 min-h-11 items-center justify-center rounded-control bg-pill-neutral-bg " +
  "text-[18px] font-semibold text-text active:bg-control " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text";

/**
 * A minus / value / plus control with 44px touch targets. The value is plain text between the two
 * buttons: a stepper is faster than typing when the user only turns one page forward.
 */
export function Stepper({ label, value, onStep }: StepperProps) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between">
      <span id={labelId} className="text-small font-medium text-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="inline-flex items-center gap-2.5">
        <button type="button" className={STEP_BUTTON} aria-label={`${label} azalt`} onClick={() => onStep(-1)}>
          −
        </button>
        <span className="min-w-8 text-center text-body font-semibold text-text tabular-nums">{value}</span>
        <button type="button" className={STEP_BUTTON} aria-label={`${label} artır`} onClick={() => onStep(1)}>
          +
        </button>
      </div>
    </div>
  );
}
