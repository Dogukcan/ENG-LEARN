import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx.ts";

/** Props both TextField and TextArea share: the label, help line and error line. */
interface FieldChromeProps {
  /** Visible label. Always required: a placeholder is not a label. */
  label: ReactNode;
  /** Optional hint shown under the field, for example "Cümle yazmak zorunda değilsin." */
  help?: ReactNode;
  /** Error text. Empty or undefined means "valid". The error line stays in the DOM either way. */
  error?: string;
  /** "body" is 16px, "large" is 18px (used for the word being captured or typed in a review). */
  textSize?: "body" | "large";
}

export type TextFieldProps = FieldChromeProps & Omit<ComponentProps<"input">, "size">;
export type TextAreaProps = FieldChromeProps & ComponentProps<"textarea">;

const BORDER = "border border-muted focus:border-text aria-invalid:border-negative";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text";

interface ChromeProps {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  /** Receives the aria-describedby string so the control can point at help + error. */
  children: (describedBy: string) => ReactNode;
}

/**
 * Shared wrapper: label, control, help line, error line.
 *
 * Why the error line is ALWAYS in the DOM: a live region (aria-live) is only announced when its
 * text CHANGES. If the element were created at the same moment as the error text, many screen
 * readers would stay silent. Rendering an empty element first and filling it later is reliable.
 * The line has no height while empty, so the layout does not jump.
 */
function FieldChrome({ id, label, help, error, children }: ChromeProps) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  // Only reference the help line when it exists. The error id is always valid (the node always exists).
  const describedBy = [help ? helpId : null, errorId].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-1.5 text-small font-medium text-text">
        {label}
      </label>
      {children(describedBy)}
      {help ? (
        <p id={helpId} className="mt-1.5 text-small leading-[1.35] text-muted">
          {help}
        </p>
      ) : null}
      <p
        id={errorId}
        aria-live="polite"
        className={cx("block text-small font-medium leading-[1.3] text-negative", error && "mt-1.5")}
      >
        {error}
      </p>
    </div>
  );
}

/**
 * Single-line text field, 56px tall.
 * Forward the native attributes you need: autoCapitalize, autoComplete, spellCheck, inputMode...
 * (they pass straight to the <input>). For a vocabulary word use autoCapitalize="none",
 * autoComplete="off" and spellCheck={false}, so iOS does not "fix" the word the user is capturing.
 */
export function TextField({ label, help, error, textSize = "body", id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldChrome id={fieldId} label={label} help={help} error={error}>
      {(describedBy) => (
        <input
          id={fieldId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(
            "h-14 w-full rounded-[14px] bg-surface px-4 text-text disabled:opacity-85",
            textSize === "large" ? "text-[18px] font-medium leading-[1.2]" : "text-body font-medium leading-[1.2]",
            BORDER,
            FOCUS,
            className,
          )}
          {...rest}
        />
      )}
    </FieldChrome>
  );
}

/** Multi-line field. Same label/help/error contract as TextField; grows vertically on demand. */
export function TextArea({ label, help, error, textSize = "body", id, className, rows = 3, ...rest }: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldChrome id={fieldId} label={label} help={help} error={error}>
      {(describedBy) => (
        <textarea
          id={fieldId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(
            "w-full resize-y rounded-[14px] bg-surface px-4 py-3 text-text",
            textSize === "large" ? "text-[18px] leading-[1.45]" : "text-body leading-[1.4]",
            BORDER,
            FOCUS,
            className,
          )}
          {...rest}
        />
      )}
    </FieldChrome>
  );
}
