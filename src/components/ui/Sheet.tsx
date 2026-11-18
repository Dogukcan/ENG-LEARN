import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

export interface SheetProps {
  /** Controlled visibility: the parent owns the state and flips it in onClose. */
  open: boolean;
  /** Called when the user asks to close (Escape key or tap on the dimmed area). Set open=false there. */
  onClose: () => void;
  /** "sheet" = bottom sheet with a dimmed backdrop. "fullscreen" = covers the whole screen. */
  variant?: "sheet" | "fullscreen";
  /** Accessible name of the dialog. Put a visible heading inside too. */
  "aria-label": string;
  /** Tapping the dimmed area closes a sheet. Turn off for forms that could lose typed text. */
  dismissOnBackdrop?: boolean;
  /**
   * Surface colour of the dialog. "surface" (default) is the card colour. "ground" is the app
   * background, for screens whose inner cards are `bg-surface` and must stand out from it
   * (the review session). Otherwise a surface card on a surface dialog is invisible.
   */
  background?: "surface" | "ground";
  /**
   * Fallback focus target for when the element that opened the sheet is gone from the DOM by the
   * time the sheet closes (e.g. an empty-state button that disappears once data is added).
   * Without it focus would fall to <body> and keyboard/screen reader users restart at page top.
   */
  returnFocusTo?: () => HTMLElement | null;
  children?: ReactNode;
}

/**
 * Modal dialog built on the native <dialog> element and showModal().
 *
 * Why native <dialog> instead of a hand-made div:
 * - The browser makes everything outside the dialog inert (cannot be focused or clicked, and is
 *   hidden from screen readers), which is the "focus trap" for free.
 * - Escape fires a "cancel" event.
 * - It renders in the top layer, so no z-index fights.
 * - Focus goes into the dialog on open. On close it returns to the opener; we also do that by
 *   hand below, because it is the one thing users notice if it breaks.
 *
 * Children are mounted only while open, so a form inside starts empty every time.
 */
export function Sheet({
  open,
  onClose,
  variant = "sheet",
  "aria-label": ariaLabel,
  dismissOnBackdrop = true,
  background = "surface",
  returnFocusTo,
  children,
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();
  // Kept in a ref so the open/close effect does not re-run when the parent passes a new function.
  const returnFocusRef = useRef(returnFocusTo);
  useEffect(() => {
    returnFocusRef.current = returnFocusTo;
  }, [returnFocusTo]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      // Remember who opened us so focus can go back there.
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // Slide up 24px while fading in, 180ms. Skipped entirely under prefers-reduced-motion.
      if (!reducedMotion && typeof dialog.animate === "function") {
        dialog.animate(
          [
            { opacity: 0, transform: "translateY(24px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 180, easing: "ease-out" },
        );
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }

    if (!open) {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
      else returnFocusRef.current?.()?.focus();
    }
  }, [open, reducedMotion]);

  // If the Sheet unmounts while open, close it so the page does not stay inert.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const isSheet = variant === "sheet";

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      // Escape: stop the browser from closing the dialog by itself, tell the parent instead.
      // That keeps React state the single source of truth.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog has no padding, so a click whose target is the <dialog> itself hit the backdrop.
      onClick={(event) => {
        if (isSheet && dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      className={cx(
        "m-0 border-0 p-0 text-text backdrop:bg-black/35",
        background === "ground" ? "bg-ground" : "bg-surface",
        isSheet
          ? "fixed inset-x-0 top-auto bottom-0 mx-auto max-h-dvh w-full max-w-[480px] overflow-y-auto rounded-t-[20px] border-t border-border"
          : "fixed inset-0 h-dvh max-h-none w-full max-w-none overflow-y-auto",
      )}
    >
      {open ? (
        // viewport-fit=cover is on, so on a landscape iPhone the notch would cover 16px side padding.
        // max() keeps 16px on devices without insets.
        <div className="flex flex-col gap-3 pt-[max(16px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-[calc(20px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))]">
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
