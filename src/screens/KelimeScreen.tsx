import { useRef, useState } from "react";
import { Button, LiveRegion, Sheet } from "../components/ui/index.ts";
import { useRepoData } from "../data/react";
import { AddWordForm } from "../features/kelime/AddWordForm.tsx";
import { InboxTriage } from "../features/kelime/InboxTriage.tsx";
import { ReviewRow } from "../features/kelime/ReviewRow.tsx";
import { ReviewSession } from "../features/review/ReviewSession.tsx";
import { recordReviewMinutes } from "../features/review/recordReview.ts";
import { useReloadOnWake } from "../features/time/useReloadOnWake.ts";
import { useTimer } from "../features/timer/TimerProvider.tsx";

/**
 * Kelime screen, variant 2 "Tek tek" (chosen as the default in the frozen UI direction).
 * This component only loads data and owns the two dialogs; the rows live in src/features/kelime.
 */
export function KelimeScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [reviewMessage, setReviewMessage] = useState("");
  const timer = useTimer();

  // Reloaded by useRepoData after every repository write, so a review or a triage updates this screen.
  const { data, error, reload } = useRepoData(async (repo) => {
    const [inbox, queue, books] = await Promise.all([
      repo.inbox.list(),
      repo.cards.getReviewQueue(new Date()),
      repo.books.list(),
    ]);
    return { inbox, queue, books };
  }, []);

  // The queue and newToday are computed from "now" at load time, so reload when the app wakes up and
  // every minute (a card marked "Unuttum" becomes due minutes later, and the local day can roll over).
  useReloadOnWake(reload);

  // Why returnFocusTo: when the inbox was empty, the "Kelime ekle" button that opened the sheet
  // disappears after the first save, so the Sheet cannot return focus to it. It falls back to the
  // header "+" button instead of letting focus drop to <body>.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const closeAdd = () => setAddOpen(false);

  return (
    <section aria-labelledby="kelime-screen-title" className="flex flex-col gap-3.5">
      <header className="flex items-center justify-between gap-3">
        <h1 id="kelime-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Kelime
        </h1>
        <Button ref={addButtonRef} variant="icon" aria-label="Kelime ekle" onClick={() => setAddOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round]">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
      </header>

      {data ? (
        <>
          <ReviewRow
            queue={data.queue}
            onStart={() => {
              setReviewMessage("");
              // One timer rule (same as Bugün): a running timer is stopped and saved first, otherwise the
              // same minutes would be counted for both that block and Kelime.
              const stopFirst = timer.running ? timer.stop() : Promise.resolve();
              stopFirst.then(
                () => setReviewOpen(true),
                () => setReviewMessage("Süre kaydedilemedi. Tekrar dene."),
              );
            }}
          />
          <LiveRegion visible>{reviewMessage}</LiveRegion>
          <InboxTriage
            inbox={data.inbox}
            queue={data.queue}
            books={data.books}
            addedCount={addedCount}
            onOpenAdd={() => setAddOpen(true)}
            onReload={reload}
          />
        </>
      ) : error ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-body leading-[1.4] text-muted">Kelimeler yüklenemedi. Tekrar dene.</p>
          <Button onClick={reload}>Tekrar dene</Button>
        </div>
      ) : (
        <p role="status" className="text-body text-muted">
          Yükleniyor…
        </p>
      )}

      <Sheet
        variant="fullscreen"
        open={addOpen}
        onClose={closeAdd}
        aria-label="Kelime ekle"
        returnFocusTo={() => addButtonRef.current}
      >
        <AddWordForm onClose={closeAdd} onAdded={() => setAddedCount((count) => count + 1)} />
      </Sheet>

      <ReviewSession
        open={reviewOpen}
        onClose={(summary) => {
          setReviewOpen(false);
          if (summary.reviewed > 0) {
            // The write triggers useRepoData's reload, so Bugün's numbers and this screen update.
            recordReviewMinutes(summary).catch(() => setReviewMessage("Süre kaydedilemedi."));
            setReviewMessage(
              `Oturum bitti: ${summary.reviewed} kart · ${summary.remembered} hatırladın · ${summary.forgotten} tekrar gelecek`,
            );
          }
        }}
      />
    </section>
  );
}
