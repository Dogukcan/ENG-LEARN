import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { cx } from "./cx.ts";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlBase<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

// An accessible name is mandatory: a radiogroup with no name is announced as just "radio group".
export type SegmentedControlProps<T extends string> = SegmentedControlBase<T> &
  ({ "aria-label": string; "aria-labelledby"?: never } | { "aria-labelledby": string; "aria-label"?: never });

/**
 * Pick exactly one of a few options ("Kitap / Video / Konuşma / Diğer").
 *
 * Why role="radiogroup" and not a row of toggle buttons: exactly one option is always chosen, which
 * is the radio contract. Screen readers then say "Diğer, radio button, 4 of 4, selected".
 * Keyboard contract (WAI-ARIA radio group): only the selected radio is in the Tab order
 * ("roving tabindex"); arrow keys move the selection and focus together.
 * The generic <T extends string> makes onChange return your own union type, not a plain string.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const { options, value, onChange, className } = props;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(index: number) {
    const count = options.length;
    const next = options[((index % count) + count) % count]; // wraps around both ends
    if (!next) return;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        select(index - 1);
        break;
      case "Home":
        event.preventDefault();
        select(0);
        break;
      case "End":
        event.preventDefault();
        select(options.length - 1);
        break;
    }
  }

  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      className={cx("grid gap-0.5 rounded-control border border-control bg-surface p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // If the value matches nothing, still keep the first option reachable by Tab.
            tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "flex min-h-11 items-center justify-center rounded-lg border px-1 text-small",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text",
              selected ? "border-muted bg-surface font-semibold text-text" : "border-transparent bg-transparent font-medium text-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
