import { useEffect, useRef, useState } from "react";
import { Button, DisabledReason, Panel, useReducedMotion } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { Book, InboxItem, ReviewQueue, WordStatus } from "../../data";
import { SentenceWithWord } from "./SentenceWithWord.tsx";
import { formatSource } from "./sourceLabel.ts";

export interface InboxTriageProps {
  inbox: InboxItem[];
  queue: ReviewQueue;
  books: Book[];
  /** Counts saved words in the add form. A new word resets the one-step undo (like the draft). */
  addedCount: number;
  onOpenAdd: () => void;
  /** Re-read the data, for the case where the repository did not change anything. */
  onReload: () => void;
}

interface UndoState {
  item: InboxItem;
  status: WordStatus;
  addedCount: number;
}

// What the user sees after a decision, e.g. "awkward: biliniyor."
const UNDO_LABEL: Record<WordStatus, string> = {
  learning: "öğrenilecek.",
  known: "biliniyor.",
  ignored: "yok sayıldı.",
};

interface PendingFocus {
  /** True once the reloaded inbox shows the result of the action. */
  done: (inbox: InboxItem[]) => boolean;
  /** After an action that leaves an undo button, an empty inbox should focus that button. */
  wantsUndoButton: boolean;
}

/**
 * Variant 2 "Tek tek": the inbox is sorted one card at a time.
 *
 * Why the screen reloads from the repository instead of editing a local list: the repository is the
 * single source of truth (useRepoData reloads after every write), so the card, the counter and the
 * tab badge can never disagree.
 */
export function InboxTriage({ inbox, queue, books, addedCount, onOpenAdd, onReload }: InboxTriageProps) {
  const reducedMotion = useReducedMotion();
  const [processed, setProcessed] = useState(0);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [saveError, setSaveError] = useState("");
  const busyRef = useRef(false);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastCardId = useRef<string | undefined>(undefined);
  const knowRef = useRef<HTMLButtonElement>(null);
  const learnRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const emptyAddRef = useRef<HTMLButtonElement>(null);

  const current = inbox[0];
  const limitReached = queue.newToday >= queue.newLimit;
  // The undo line belongs to the moment before the next word was added.
  const visibleUndo = undo && undo.addedCount === addedCount ? undo : null;
  // Total = already sorted + still waiting. It grows by itself when a word is added and does not
  // change when an action is undone, so no separate "starting total" state is needed.
  const total = processed + inbox.length;

  // Slide the next card in from the right (24px, 180ms). Skipped for reduced motion and for the first card.
  useEffect(() => {
    const element = cardRef.current;
    const id = current?.id;
    if (!element || !id) return;
    if (lastCardId.current && lastCardId.current !== id && !reducedMotion && typeof element.animate === "function") {
      element.animate(
        [
          { opacity: 0, transform: "translateX(24px)" },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    }
    lastCardId.current = id;
  }, [current?.id, reducedMotion]);

  // Move focus after the reloaded data is on screen. The old button may have just disappeared, so
  // without this a keyboard or screen reader user would be dropped back at the top of the page.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !pending.done(inbox)) return;
    if (inbox.length === 0) {
      if (pending.wantsUndoButton && !undoRef.current) return; // the undo line has not rendered yet
      pendingFocus.current = null;
      (undoRef.current ?? emptyAddRef.current)?.focus();
      return;
    }
    pendingFocus.current = null;
    // A disabled "Öğren" is skipped, so focus lands on a button that works.
    (limitReached ? knowRef.current : learnRef.current)?.focus();
  });

  async function decide(status: WordStatus) {
    if (!current || busyRef.current) return;
    if (status === "learning" && limitReached) return;
    busyRef.current = true;
    setSaveError("");
    const item = current;
    try {
      pendingFocus.current = {
        done: (list) => !list.some((i) => i.id === item.id),
        wantsUndoButton: status !== "learning",
      };
      const result = await repository.words.triage(item.id, status);
      if (!result.ok) {
        // "new-card-limit" and "not-found" change nothing, so no write notification will come.
        pendingFocus.current = null;
        onReload();
        return;
      }
      setProcessed((count) => count + 1);
      setUndo({ item, status, addedCount });
    } catch {
      // Why: a rejected write must not leave a stale pendingFocus (it would steal focus on a later reload).
      pendingFocus.current = null;
      setSaveError("Kaydedilemedi. Tekrar dene.");
    } finally {
      busyRef.current = false;
    }
  }

  async function undoLast() {
    if (!visibleUndo || busyRef.current) return;
    // The repository cannot take a Word back. For "known" and "ignored" the Word stays, so the
    // restored inbox item carries previousStatus: the next triage then UPDATES that Word instead
    // of creating a second one. "learning" created a review card, which cannot be removed
    // cleanly, so it has no undo button.
    if (visibleUndo.status === "learning") return;
    busyRef.current = true;
    const { item, status } = visibleUndo;
    setSaveError("");
    try {
      pendingFocus.current = {
        done: (list) => list.some((i) => i.id === item.id),
        wantsUndoButton: false,
      };
      const result = await repository.inbox.restore({ ...item, previousStatus: status });
      setUndo(null);
      if (result.ok) {
        setProcessed((count) => Math.max(0, count - 1));
      } else {
        pendingFocus.current = null;
        onReload();
      }
    } catch {
      pendingFocus.current = null;
      setSaveError("Kaydedilemedi. Tekrar dene.");
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-section leading-[1.25] font-semibold text-text">Gelen kutusu</h2>
        {current ? (
          <span className="num text-small font-semibold text-muted">
            {processed + 1} / {total}
          </span>
        ) : null}
      </div>

      <div role="status" aria-live="polite">
        {visibleUndo ? (
          <div className="flex items-center justify-between gap-2 px-0.5 text-small text-muted">
            <span>
              {visibleUndo.item.word}: {UNDO_LABEL[visibleUndo.status]}
            </span>
            {visibleUndo.status !== "learning" ? (
              <Button
                ref={undoRef}
                variant="text"
                onClick={undoLast}
                className="shrink-0 font-semibold underline underline-offset-[3px]"
              >
                Geri al
              </Button>
            ) : null}
          </div>
        ) : null}
        {saveError ? <p className="px-0.5 text-small text-muted">{saveError}</p> : null}
      </div>

      {current ? (
        <div className="flex flex-col gap-3.5">
          {/* The ref sits on a plain div because Panel does not accept a ref. */}
          <div ref={cardRef}>
          <Panel as="article" className="flex flex-col gap-2.5">
            <p className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-text">{current.word}</p>
            {current.meaningTr ? (
              <p className="text-body leading-[1.35] text-muted">{current.meaningTr}</p>
            ) : null}
            {current.sentence ? (
              <p className="text-[18px] leading-[1.45] break-words text-text">
                <SentenceWithWord sentence={current.sentence} word={current.word} />
              </p>
            ) : null}
            <p className="text-small leading-[1.3] text-muted">{formatSource(current.source, books)}</p>
            {current.previousStatus ? (
              <p className="text-small leading-[1.3] text-muted">
                {current.previousStatus === "known" ? "Daha önce: biliyorum" : "Daha önce: yok saydın"}
              </p>
            ) : null}
          </Panel>
          </div>

          {limitReached ? (
            <DisabledReason id="kelime-limit-reason">{`Bugünkü yeni kart sınırı doldu (${queue.newLimit})`}</DisabledReason>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <Button onClick={() => decide("ignored")}>Yok say</Button>
            <Button ref={knowRef} onClick={() => decide("known")}>
              Biliyorum
            </Button>
            <Button
              ref={learnRef}
              onClick={() => decide("learning")}
              disabled={limitReached}
              aria-describedby={limitReached ? "kelime-limit-reason" : undefined}
              // "!" makes these win over the neutral look: "Öğren" is the heavier choice (700, 1px text border).
              className="border-text! font-bold! aria-disabled:border-control!"
            >
              Öğren
            </Button>
          </div>
        </div>
      ) : (
        <Panel className="flex flex-col gap-3.5">
          <p className="text-body leading-[1.4] text-muted">Gelen kutusu boş.</p>
          <Button ref={emptyAddRef} onClick={onOpenAdd}>
            Kelime ekle
          </Button>
        </Panel>
      )}
    </>
  );
}
