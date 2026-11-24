import { useRef, useState } from "react";
import { Button, LiveRegion, Sheet } from "../components/ui/index.ts";
import { useRepoData } from "../data/react";
import { toLocalDay } from "../data";
import { AddWordForm } from "../features/kelime/AddWordForm.tsx";
import { InboxTriage } from "../features/kelime/InboxTriage.tsx";
import { kelimeHeroAction, kelimeHeroSubtitle } from "../features/kelime/heroLabels.ts";
import { doneMinutes } from "../features/okuma/logic.ts";
import { SkillHero } from "../features/skill/SkillHero.tsx";
import { heroRemaining } from "../features/skill/heroLogic.ts";
import { ReviewSession } from "../features/review/ReviewSession.tsx";
import { recordReviewMinutes } from "../features/review/recordReview.ts";
import { useReloadOnWake } from "../features/time/useReloadOnWake.ts";
import { useTimer } from "../features/timer/TimerProvider.tsx";

/**
 * Skill ring hero with the existing "Tek tek" inbox triage.
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
    const now = new Date();
    const [inbox, queue, books, minutes, settings] = await Promise.all([
      repo.inbox.list(),
      repo.cards.getReviewQueue(now),
      repo.books.list(),
      repo.activity.minutesPerBlockForDay(toLocalDay(now)),
      repo.settings.get(),
    ]);
    return { inbox, queue, books, loggedMinutes: minutes.kelime, plan: settings.blockPlanMinutes.kelime };
  }, []);

  // The queue and newToday are computed from "now" at load time, so reload when the app wakes up and
  // every minute (a card marked "Unuttum" becomes due minutes later, and the local day can roll over).
  useReloadOnWake(reload);

  // Keep the existing stable header focus target after adding words, even when reloads
  // change the inbox or the hero action that opened the sheet.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const closeAdd = () => setAddOpen(false);
  const runningSeconds = timer.running === "kelime" ? timer.elapsedSeconds : null;
  const done = doneMinutes(data?.loggedMinutes ?? 0, runningSeconds ?? 0);
  const subtitle = data ? kelimeHeroSubtitle(data.queue) : "";
  const action = kelimeHeroAction(runningSeconds !== null, timer.elapsedSeconds, data?.queue.cards.length ?? 0);

  function onHeroAction() {
    setReviewMessage("");
    if (timer.running === "kelime") {
      timer.stop().catch(() => setReviewMessage("Süre kaydedilemedi. Tekrar dene."));
    } else if (data && data.queue.cards.length > 0) {
      // Save the running block before review so its minutes are not counted twice.
      const stopFirst = timer.running ? timer.stop() : Promise.resolve();
      stopFirst.then(
        () => setReviewOpen(true),
        () => setReviewMessage("Süre kaydedilemedi. Tekrar dene."),
      );
    } else {
      setAddOpen(true);
    }
  }

  return (
    <section aria-labelledby="kelime-screen-title" className="flex flex-col gap-3.5">
      <header className="flex items-center justify-between gap-3">
        <h1 id="kelime-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Kelime
        </h1>
        <Button tactile ref={addButtonRef} variant="icon" aria-label="Kelime ekle" onClick={() => setAddOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round]">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
      </header>

      {data ? (
        <>
          <SkillHero
            block="kelime"
            title="Kelime"
            doneMinutes={done}
            planMinutes={data.plan}
            runningSeconds={runningSeconds}
            subtitle={subtitle}
            chips={[heroRemaining(done, data.plan)]}
            actionLabel={action.label}
            actionAriaLabel={action.ariaLabel}
            onAction={onHeroAction}
            detail={<p className="text-body text-muted">{subtitle}</p>}
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
          <Button tactile onClick={reload}>Tekrar dene</Button>
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
