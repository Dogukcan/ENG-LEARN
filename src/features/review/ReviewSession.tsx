import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, SyntheticEvent } from "react";
import { Button, LiveRegion, ProgressTrack, Sheet, cx, useReducedMotion } from "../../components/ui";
import { buildPrompt, checkAnswer, repository } from "../../data";
import type { ReviewGrade, ReviewQueue } from "../../data";
import { answerLabel } from "./answerLabel";

export interface ReviewSummary {
  reviewed: number;
  remembered: number;
  forgotten: number;
  minutes: number;
  /** ISO time the session opened, for the activity log. */
  startedAt: string;
}

export interface ReviewSessionProps {
  open: boolean;
  onClose: (summary: ReviewSummary) => void;
}

type QueueItem = ReviewQueue["cards"][number];

const NBSP = " ";

/**
 * Full-screen review session.
 *
 * Why the Sheet wraps a separate inner component: the Sheet mounts its children only while `open`,
 * so every time the session opens, the inner component starts with fresh state (index 0, empty
 * history, a new queue load). We never have to "reset" anything by hand.
 */
export function ReviewSession({ open, onClose }: ReviewSessionProps) {
  // The Escape key is handled by the Sheet (outside the session body), but the summary numbers
  // live inside the body. The body registers its "end the session" function here.
  const endRef = useRef<() => void>(() => {});

  return (
    <Sheet
      open={open}
      variant="fullscreen"
      background="ground"
      aria-label="Kelime tekrar oturumu"
      onClose={() => endRef.current()}
    >
      <SessionBody endRef={endRef} onClose={onClose} />
    </Sheet>
  );
}

interface SessionBodyProps {
  endRef: MutableRefObject<() => void>;
  onClose: (summary: ReviewSummary) => void;
}

function SessionBody({ endRef, onClose }: SessionBodyProps) {
  const reducedMotion = useReducedMotion();

  // The queue is loaded once and then kept here: cards graded during the session must not
  // disappear or reorder under the user's hands.
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  // One entry per graded card, in order. history.length always equals `index`, which is what makes
  // "undo" simple: undo removes the last entry and steps back one card.
  const [history, setHistory] = useState<ReviewGrade[]>([]);
  const [typed, setTyped] = useState("");
  // null = not checked yet. After "Kontrol et" (or "Cevabı göster") it holds the verdict.
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const startedAt = useRef(Date.now());
  const historyRef = useRef<ReviewGrade[]>([]);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const forgotRef = useRef<HTMLButtonElement>(null);
  const rememberedRef = useRef<HTMLButtonElement>(null);
  const summaryTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Load the queue once, when the session opens. `cancelled` stops a late answer from touching
  // state after the sheet was closed.
  useEffect(() => {
    let cancelled = false;
    repository.cards
      .getReviewQueue(new Date())
      .then((result) => {
        if (!cancelled) setQueue(result.cards);
      })
      .catch(() => {
        if (!cancelled) {
          setQueue([]);
          setMessage("Kartlar yüklenemedi.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ending the session: grades are already saved one by one, so we only report the numbers.
  useEffect(() => {
    endRef.current = () => {
      const grades = historyRef.current;
      const reviewed = grades.length;
      const remembered = grades.filter((grade) => grade === "good").length;
      const minutes = reviewed > 0 ? Math.max(1, Math.round((Date.now() - startedAt.current) / 60000)) : 0;
      onClose({
        reviewed,
        remembered,
        forgotten: reviewed - remembered,
        minutes,
        startedAt: new Date(startedAt.current).toISOString(),
      });
    };
  }, [endRef, onClose]);

  const total = queue?.length ?? 0;
  const finished = queue !== null && total > 0 && index >= total;
  const current = queue !== null && index < total ? queue[index] : undefined;
  const prompt = current ? buildPrompt(current.word) : undefined;

  // Slide the new card in: 24px from the right plus fade, 180ms. Skipped with reduced motion.
  // Runs when the index changes (and once for the first card).
  useEffect(() => {
    const el = cardRef.current;
    if (!current || !el || reducedMotion || typeof el.animate !== "function") return;
    el.animate(
      [
        { opacity: 0, transform: "translateX(24px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    // Only the card identity matters here, not every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.card.id, reducedMotion]);

  // Focus rules: a fresh card puts the cursor where the user acts first; a checked card moves
  // focus to the grade the answer suggests; the summary focuses its heading.
  useEffect(() => {
    if (finished) {
      summaryTitleRef.current?.focus();
      return;
    }
    if (!current || !prompt) return;
    if (correct === null) {
      (prompt.kind === "recall" ? revealRef.current : inputRef.current)?.focus();
    } else if (prompt.kind === "recall") {
      rememberedRef.current?.focus();
    } else {
      (correct ? rememberedRef.current : forgotRef.current)?.focus();
    }
    // `prompt` is rebuilt each render; the card id and verdict are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.card.id, correct, finished]);

  function endSession() {
    endRef.current();
  }

  function check(event?: SyntheticEvent) {
    event?.preventDefault();
    if (!current || !prompt || correct !== null) return;
    if (prompt.kind === "recall") {
      // Self-grade card: nothing to compare, the user only reveals the grade buttons.
      setCorrect(true);
      return;
    }
    setCorrect(checkAnswer(typed, current.word));
  }

  // iOS Safari only opens the keyboard for focus() calls made synchronously inside a user tap.
  // The effect-based focus runs after `await`, so it is not enough. The input stays mounted (and
  // editable, see below) between typed cards, so we focus it here, before any await.
  function focusInputForCard(item: QueueItem | undefined) {
    if (item && buildPrompt(item.word).kind !== "recall") inputRef.current?.focus();
  }

  async function grade(value: ReviewGrade) {
    if (!current || busy) return;
    focusInputForCard(queue?.[index + 1]);
    setBusy(true);
    setMessage("");
    try {
      const result = await repository.cards.reviewCard(current.card.id, value, new Date());
      if (!result.ok) {
        setMessage("Bu kart artık yok. Oturumu kapatıp yeniden aç.");
        return;
      }
      setHistory((previous) => [...previous, value]);
      setIndex((previous) => previous + 1);
      setTyped("");
      setCorrect(null);
    } catch {
      setMessage("Cevap kaydedilemedi. Tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy || history.length === 0) return;
    focusInputForCard(queue?.[index - 1]);
    setBusy(true);
    setMessage("");
    try {
      const result = await repository.cards.undoLastReview();
      if (!result.ok) {
        setMessage("Geri alınacak cevap yok.");
        return;
      }
      setHistory((previous) => previous.slice(0, -1));
      setIndex((previous) => Math.max(0, previous - 1));
      setTyped("");
      setCorrect(null);
    } catch {
      setMessage("Geri alınamadı. Tekrar dene.");
    } finally {
      setBusy(false);
    }
  }

  const remembered = history.filter((value) => value === "good").length;
  const forgotten = history.length - remembered;
  const empty = queue !== null && total === 0;
  const showUndo = history.length > 0 && !empty;

  const closeButton = (
    <button
      type="button"
      onClick={endSession}
      aria-label="Kapat"
      className={cx(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control border border-control bg-surface px-3",
        "text-small font-semibold text-text",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
      )}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current stroke-[1.75] [stroke-linecap:round]">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
      <span>Kapat</span>
    </button>
  );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-max(16px,env(safe-area-inset-top))-20px-env(safe-area-inset-bottom))] w-full max-w-[480px] flex-col gap-5">
      <header className="flex items-center gap-3">
        {closeButton}
        <ProgressTrack
          value={Math.min(index, total)}
          max={Math.max(total, 1)}
          block="kelime"
          label="Kart ilerlemesi"
          valueText={`${Math.min(index, total)} / ${total} kart`}
        />
        <span className="num shrink-0 whitespace-nowrap text-small font-semibold text-muted">
          {total > 0 ? `${Math.min(index + 1, total)}${NBSP}/${NBSP}${total}` : ""}
        </span>
      </header>

      {queue === null ? <p className="text-small text-muted">Yükleniyor…</p> : null}

      {empty ? (
        <div className="flex flex-1 flex-col justify-between gap-5">
          <div className="flex flex-col gap-2 rounded-card bg-surface p-6">
            <h2 className="text-section font-semibold text-text">Şu an tekrar edilecek kart yok.</h2>
          </div>
          <Button variant="primary-block" block="kelime" onClick={endSession}>
            Kelime&apos;ye dön
          </Button>
        </div>
      ) : null}

      {finished ? (
        <div className="flex flex-1 flex-col justify-between gap-5">
          <div className="flex flex-col gap-2 rounded-card bg-surface p-6">
            <h2
              ref={summaryTitleRef}
              tabIndex={-1}
              className="text-title font-semibold tracking-[-0.02em] text-text outline-none"
            >
              Oturum bitti
            </h2>
            <p className="text-body font-medium leading-[1.4] text-muted">
              {`${history.length}${NBSP}kart · ${remembered}${NBSP}hatırladın · ${forgotten}${NBSP}tekrar gelecek`}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {showUndo ? <UndoButton onClick={undo} /> : null}
            <Button variant="primary-block" block="kelime" onClick={endSession}>
              Kelime&apos;ye dön
            </Button>
          </div>
        </div>
      ) : null}

      {current && prompt ? (
        <div className="flex flex-1 flex-col gap-4">
          <article ref={cardRef} className="flex flex-col gap-3 rounded-card bg-surface p-6">
            {prompt.kind === "recall" ? (
              <p className="text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text">{prompt.text}</p>
            ) : (
              <p className="text-section font-medium leading-[1.5] text-text">{prompt.text}</p>
            )}
            {prompt.kind === "cloze" && prompt.hint ? (
              <p className="text-small leading-[1.35] text-muted">{`İpucu: ${prompt.hint}`}</p>
            ) : null}
          </article>

          {prompt.kind !== "recall" ? (
            <form onSubmit={check} className="flex flex-col gap-4" noValidate>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                // Not `disabled`/`readOnly`: iOS will not open the keyboard on a locked input, and the
                // next card reuses this node. We ignore edits after the check instead.
                onChange={(event) => {
                  if (correct === null) setTyped(event.target.value);
                }}
                aria-readonly={correct !== null}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={prompt.kind === "cloze" ? "Boşluğa gelecek İngilizce kelime" : "Bu anlamın İngilizcesi"}
                placeholder="Kelimeyi yaz…"
                className={cx(
                  "h-14 w-full rounded-[14px] border border-muted bg-surface px-4 text-[18px] font-medium leading-[1.2] text-text",
                  "focus:border-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
                  correct !== null && "opacity-85",
                )}
              />
              {/* The submit button lives inside the form so Enter in the input submits. */}
              {correct === null ? (
                <Button type="submit" variant="primary-block" block="kelime">
                  Kontrol et
                </Button>
              ) : null}
            </form>
          ) : null}

          {/* Result panel: always in the DOM so screen readers announce the text when it appears. */}
          <div
            role="status"
            aria-live="polite"
            className={cx(
              "flex flex-col gap-1 rounded-[14px]",
              correct === true && prompt.kind !== "recall" && "bg-pill-positive-bg px-4 py-3.5 text-pill-positive-ink",
              correct === false && "bg-pill-negative-bg px-4 py-3.5 text-pill-negative-ink",
            )}
          >
            {correct !== null && prompt.kind !== "recall" ? (
              <p className="text-body font-semibold leading-[1.3]">
                {correct ? `Doğru: ${prompt.answer}` : `Doğru cevap: ${answerLabel(prompt)}`}
              </p>
            ) : null}
          </div>

          <div className="mt-auto flex flex-col gap-3">
            {prompt.kind === "recall" && correct === null ? (
              <Button ref={revealRef} variant="primary-block" block="kelime" onClick={() => check()}>
                Kendini değerlendir
              </Button>
            ) : null}

            {correct !== null ? (
              <div className="grid grid-cols-2 gap-3">
                <Button ref={forgotRef} variant="neutral" disabled={busy} onClick={() => void grade("again")}>
                  Unuttum
                </Button>
                <Button
                  ref={rememberedRef}
                  variant="primary-block"
                  block="kelime"
                  disabled={busy}
                  onClick={() => void grade("good")}
                >
                  Hatırladım
                </Button>
              </div>
            ) : null}

            {showUndo ? <UndoButton onClick={undo} /> : null}
          </div>
        </div>
      ) : null}

      <LiveRegion visible>{message}</LiveRegion>
    </div>
  );
}

function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="text" onClick={onClick} className="self-center">
      Son cevabı geri al
    </Button>
  );
}
