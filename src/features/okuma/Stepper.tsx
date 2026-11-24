import { useId } from "react";
import { Button } from "../../components/ui/index.ts";

export interface StepperProps {
  /** Visible label on the left, e.g. "Sayfa". The buttons are named "<label> azalt" / "<label> artır". */
  label: string;
  value: number;
  onStep: (delta: 1 | -1) => void;
}

/**
 * A minus / value / plus control with 48px round tactile touch targets. The value is plain text between the two
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
        <Button tactile variant="icon" className="size-12 text-section" aria-label={`${label} azalt`} onClick={() => onStep(-1)}>
          −
        </Button>
        <span className="min-w-8 text-center text-body font-semibold text-text tabular-nums">{value}</span>
        <Button tactile variant="icon" className="size-12 text-section" aria-label={`${label} artır`} onClick={() => onStep(1)}>
          +
        </Button>
      </div>
    </div>
  );
}
