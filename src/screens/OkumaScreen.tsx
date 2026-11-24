import { useState } from "react";
import { LiveRegion, LoadError } from "../components/ui/index.ts";
import { useRepoData } from "../data/react";
import { BookPanel } from "../features/okuma/BookPanel.tsx";
import { CapturePanel } from "../features/okuma/CapturePanel.tsx";
import { CapturedToday } from "../features/okuma/CapturedToday.tsx";
import { bookSubtitle, capturedToday, doneMinutes } from "../features/okuma/logic.ts";
import { SkillHero } from "../features/skill/SkillHero.tsx";
import { heroRemaining } from "../features/skill/heroLogic.ts";
import { formatMMSS } from "../features/timer/timerMath.ts";
import { useReloadOnWake } from "../features/time/useReloadOnWake.ts";
import { useTimer } from "../features/timer/TimerProvider.tsx";
import { toLocalDay } from "../data";

/**
 * Okuma screen. This component loads the data and arranges the pieces;
 * the pieces and the pure rules live in src/features/okuma.
 */
export function OkumaScreen() {
  const timer = useTimer();
  const { running, elapsedSeconds } = timer;
  const [message, setMessage] = useState("");

  // Reloaded by useRepoData after every repository write: a saved word, a page step, a stopped timer.
  const { data, error, reload } = useRepoData(async (repo) => {
    const now = new Date();
    const [books, settings, inbox, minutes] = await Promise.all([
      repo.books.list(),
      repo.settings.get(),
      repo.inbox.list(),
      repo.activity.minutesPerBlockForDay(toLocalDay(now)),
    ]);
    // Without a chosen book (first launch) the first one is shown, so the screen is never empty.
    const activeBook = books.find((book) => book.id === settings.activeBookId) ?? books[0];
    return { books, activeBook, inbox, plan: settings.blockPlanMinutes.okuma, loggedMinutes: minutes.okuma, now };
  }, []);

  // "Today's minutes" and the captured-today list are read at load time; refresh them across midnight.
  useReloadOnWake(reload);

  const done = data ? doneMinutes(data.loggedMinutes, running === "okuma" ? elapsedSeconds : 0) : 0;

  return (
    <section aria-labelledby="okuma-screen-title" className="flex flex-col gap-3.5">
      <header className="flex items-baseline justify-between gap-3">
        <h1 id="okuma-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Okuma
        </h1>
      </header>

      {data ? (
        <SkillHero
          block="okuma"
          doneMinutes={done}
          planMinutes={data.plan}
          runningSeconds={running === "okuma" ? elapsedSeconds : null}
          title="Okuma"
          subtitle={data.activeBook ? bookSubtitle(data.activeBook) : ""}
          chips={[heroRemaining(done, data.plan)]}
          actionLabel={running === "okuma" ? `Durdur · ${formatMMSS(elapsedSeconds)}` : "Okumayı başlat"}
          actionAriaLabel={running === "okuma" ? "Okuma sayacını durdur" : "Okuma sayacını başlat"}
          onAction={() => {
            setMessage("");
            void timer.toggle("okuma").catch(() => setMessage("Süre kaydedilemedi. Tekrar dene."));
          }}
          detail={<p>Sayaç başlayınca süre kendiliğinden kaydedilir. Durdurunca tam dakika olarak eklenir.</p>}
        />
      ) : null}
      <LiveRegion visible>{message}</LiveRegion>

      {!data && error ? <LoadError onRetry={reload} /> : null}

      {data?.activeBook ? (
        <>
          <BookPanel books={data.books} activeBook={data.activeBook} />
          <CapturePanel book={data.activeBook} />
          <CapturedToday rows={capturedToday(data.inbox, data.books, data.now)} />
        </>
      ) : null}
    </section>
  );
}
