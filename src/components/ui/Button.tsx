import type { ComponentProps } from "react";
import type { Block } from "./cx.ts";
import { cx } from "./cx.ts";

type NativeButtonProps = Omit<ComponentProps<"button">, "disabled" | "type">;

type SharedProps = NativeButtonProps & {
  /**
   * Disabled state. We use aria-disabled instead of the native `disabled` attribute because a
   * natively disabled button cannot receive focus, so a screen reader user would never reach it
   * and never hear WHY it is off. A focusable aria-disabled button plus aria-describedby that
   * points at a visible reason (see DisabledReason) solves that.
   */
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
};

export type ButtonProps =
  | (SharedProps & {
      /**
       * primary-block: filled with the block ink colour, 56px. neutral: surface + control border, 56px.
       * text: no fill or border, 44px.
       */
      variant?: "primary-block" | "neutral" | "text";
      /** Which block's ink colour fills a primary-block button. Ignored by the other variants. */
      block?: Block;
    })
  | (SharedProps & {
      /** Round 44px icon button. It has no visible text, so an accessible name is required. */
      variant: "icon";
      "aria-label": string;
      block?: never;
    });

// Primary fills: normal and pressed colour per block (tokens from tokens.css).
const PRIMARY: Record<Block, string> = {
  okuma: "bg-okuma-btn-bg text-okuma-btn-text not-aria-disabled:active:bg-okuma-btn-active",
  kelime: "bg-kelime-btn-bg text-kelime-btn-text not-aria-disabled:active:bg-kelime-btn-active",
  dinleme: "bg-dinleme-btn-bg text-dinleme-btn-text not-aria-disabled:active:bg-dinleme-btn-active",
  konusma: "bg-konusma-btn-bg text-konusma-btn-text not-aria-disabled:active:bg-konusma-btn-active",
};

const BASE =
  "inline-flex select-none items-center justify-center font-semibold " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text " +
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

// Only transform and background-color are animated (cheap for the GPU, no layout shift).
const PRESS = "transition-[scale,background-color] duration-120 not-aria-disabled:active:scale-[0.97]";

/**
 * One Button component with four looks. Keeping them in one place means every screen gets the
 * same sizes (touch targets of 44px or 56px) and the same press feedback.
 */
export function Button(props: ButtonProps) {
  const { variant = "neutral", block, disabled = false, className, onClick, type = "button", ...rest } = props;

  let look: string;
  switch (variant) {
    case "primary-block":
      look = cx("h-14 w-full rounded-[14px] text-body", PRESS, PRIMARY[block ?? "kelime"]);
      break;
    case "neutral":
      look = cx(
        "h-14 w-full rounded-[14px] border border-control bg-surface text-body text-text",
        "transition-[scale,background-color] duration-120",
        "not-aria-disabled:active:scale-[0.97] not-aria-disabled:active:bg-control",
      );
      break;
    case "text":
      look = cx(
        "h-11 rounded-control px-2 text-small text-text transition-[background-color] duration-120",
        "not-aria-disabled:active:bg-rule",
      );
      break;
    case "icon":
      look = cx(
        "size-11 shrink-0 rounded-full border border-control bg-surface text-text",
        "transition-[scale,background-color] duration-120",
        "not-aria-disabled:active:scale-[0.96] not-aria-disabled:active:bg-control",
      );
      break;
  }

  return (
    <button
      type={type}
      className={cx(BASE, look, className)}
      aria-disabled={disabled || undefined}
      // A button that is aria-disabled is still clickable in the browser, so we must swallow the click.
      onClick={disabled ? (event) => event.preventDefault() : onClick}
      {...rest}
    />
  );
}

export interface DisabledReasonProps {
  /** Must equal the aria-describedby of the disabled control. */
  id: string;
  /** Visible explanation, for example "Günlük 10 yeni kart sınırına ulaştın." Empty = nothing shown. */
  children?: string;
}

/**
 * Visible text that explains why a control is disabled. Sighted users read it, and because the
 * button's aria-describedby points at this id, screen readers announce it together with the button.
 * It stays in the DOM even when empty so the id always resolves.
 */
export function DisabledReason({ id, children }: DisabledReasonProps) {
  return (
    <p id={id} className="text-small font-medium leading-[1.35] text-muted">
      {children}
    </p>
  );
}
