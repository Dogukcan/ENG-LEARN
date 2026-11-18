import { useEffect, useRef, useState } from "react";
import { Button, LiveRegion, Sheet } from "../components/ui/index.ts";
import { useRepoData } from "../data/react";
import { AddWordForm } from "../features/kelime/AddWordForm.tsx";
import { InboxTriage } from "../features/kelime/InboxTriage.tsx";
import { ReviewRow } from "../features/kelime/ReviewRow.tsx";
import { ReviewSession } from "../features/review/ReviewSession.tsx";

/**
 * Kelime screen, variant 2 "Tek tek" (chosen as the default in design/ui-freeze.md).
 * This component only loads data and owns the two dialogs; the rows live in src/features/kelime.
 */
export function KelimeScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [reviewMessage, setReviewMessage] = useState("");

  // Reloaded by useRepoData after every repository write, so a review or a triage updates this screen.
  const { data, error, reload } = useRepoData(async (repo) => {
    const [inbox, queue, books] = await Promise.all([
      repo.inbox.list(),
      repo.cards.getReviewQueue(new Date()),
      repo.books.list(),
    ]);
    return { inbox, queue, books };
  }, []);

  // Why a timer: the queue and newToday are computed from "now" at load time. A card marked "Unuttum"
  // becomes due 1-10 minutes later and the local day can roll over, but no repository write happens
  // then, so without this the screen would keep showing the old state until the user leaves and returns.
  useEffect(() => {
    const interval = window.setInterval(reload, 60_000);
    // Timers are throttled in background tabs, so also reload the moment the page becomes visible.
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // Why a fallback: when the inbox was empty, the "Kelime ekle" button that opened the sheet disappears
  // after the first save, so the Sheet cannot return focus to it and focus would fall to <body>.
  // Sheet.tsx is owned elsewhere, so the screen moves focus to the header "+" button itself.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  function closeAdd() {
    setAddOpen(false);
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) addButtonRef.current?.focus();
    }, 0);
  }

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
              setReviewOpen(true);
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

      <Sheet variant="fullscreen" open={addOpen} onClose={closeAdd} aria-label="Kelime ekle">
        <AddWordForm onClose={closeAdd} onAdded={() => setAddedCount((count) => count + 1)} />
      </Sheet>

      <ReviewSession
        open={reviewOpen}
        onClose={(summary) => {
          setReviewOpen(false);
          if (summary.reviewed > 0) {
            setReviewMessage(
              `Oturum bitti: ${summary.reviewed} kart · ${summary.remembered} hatırladın · ${summary.forgotten} tekrar gelecek`,
            );
          }
        }}
      />
    </section>
  );
}
