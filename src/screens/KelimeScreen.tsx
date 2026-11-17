import { useState } from "react";
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
  const { data, reload } = useRepoData(async (repo) => {
    const [inbox, queue, books] = await Promise.all([
      repo.inbox.list(),
      repo.cards.getReviewQueue(new Date()),
      repo.books.list(),
    ]);
    return { inbox, queue, books };
  }, []);

  return (
    <section aria-labelledby="kelime-screen-title" className="flex flex-col gap-3.5">
      <header className="flex items-center justify-between gap-3">
        <h1 id="kelime-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Kelime
        </h1>
        <Button variant="icon" aria-label="Kelime ekle" onClick={() => setAddOpen(true)}>
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
      ) : null}

      <Sheet variant="fullscreen" open={addOpen} onClose={() => setAddOpen(false)} aria-label="Kelime ekle">
        <AddWordForm onClose={() => setAddOpen(false)} onAdded={() => setAddedCount((count) => count + 1)} />
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
