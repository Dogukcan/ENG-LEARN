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
  children,
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();

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
        "m-0 border-0 bg-surface p-0 text-text backdrop:bg-black/35",
        isSheet
          ? "fixed inset-x-0 top-auto bottom-0 mx-auto max-h-dvh w-full max-w-[480px] overflow-y-auto rounded-t-[20px] border-t border-border"
          : "fixed inset-0 h-dvh max-h-none w-full max-w-none overflow-y-auto",
      )}
    >
      {open ? (
        <div className="flex flex-col gap-3 p-4 pb-[calc(20px+env(safe-area-inset-bottom))]">{children}</div>
      ) : null}
    </dialog>
  );
}
