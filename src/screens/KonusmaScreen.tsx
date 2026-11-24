import { useEffect, useState } from "react";
import { LiveRegion, LoadError, SegmentedControl } from "../components/ui/index.ts";
import { addLocalDays, toLocalDay } from "../data";
import { useRepoData } from "../data/react.ts";
import { ErrorLog } from "../features/konusma/ErrorLog.tsx";
import { PrepareStep } from "../features/konusma/PrepareStep.tsx";
import { ReportStep } from "../features/konusma/ReportStep.tsx";
import { TimerStep } from "../features/konusma/TimerStep.tsx";
import { SCENARIOS } from "../features/konusma/logic/scenarios.ts";
import {
  isPlannedToday,
  pickTargetWords,
  plannedDays,
  plannedDaysLine,
} from "../features/konusma/logic/session.ts";
import { initialStep, loadSavedSession, saveSession } from "../features/konusma/logic/sessionState.ts";
import type { Step } from "../features/konusma/logic/sessionState.ts";
import { doneMinutes } from "../features/okuma/logic.ts";
import { SkillHero } from "../features/skill/SkillHero.tsx";
import { heroRemaining } from "../features/skill/heroLogic.ts";
import { useReloadOnWake } from "../features/time/useReloadOnWake.ts";
import { useTimer } from "../features/timer/TimerProvider.tsx";
import { formatMMSS } from "../features/timer/timerMath.ts";

const STEP_OPTIONS = [
  { value: "1", label: "1 Hazırlan" },
  { value: "2", label: "2 Konuş" },
  { value: "3", label: "3 Rapor" },
] as const;

/**
 * Konuşma screen with the skill hero and session steps. This component loads the data and picks the step;
 * the steps live in src/features/konusma and the pure rules in its logic/ folder.
 */
export function KonusmaScreen() {
  const timer = useTimer();
  const { running, elapsedSeconds } = timer;
  const [message, setMessage] = useState("");
  // Restored after a reload (iOS may drop the app while the learner talks in another app).
  const [saved] = useState(() => loadSavedSession(SCENARIOS.map((item) => item.id)));
  const [step, setStep] = useState<Step>(() => initialStep(saved, running === "konusma"));
  const [scenarioId, setScenarioId] = useState<string>(saved?.scenarioId ?? SCENARIOS[0]?.id ?? "");
  useEffect(() => {
    saveSession({ step, scenarioId });
  }, [step, scenarioId]);
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];

  // Reloaded after every repository write: a stopped timer, a saved report.
  const { data, error, reload } = useRepoData(async (repo) => {
    const now = new Date();
    const today = toLocalDay(now);
    const [settings, minutes, queue, learning, errors] = await Promise.all([
      repo.settings.get(),
      repo.activity.minutesPerBlockForDay(today),
      repo.cards.getReviewQueue(now),
      repo.words.listByStatus("learning"),
      repo.speaking.errorsPerCategory({ from: addLocalDays(today, -6), to: today }),
    ]);
    return {
      now,
      plan: settings.blockPlanMinutes.konusma,
      loggedMinutes: minutes.konusma,
      targetWords: pickTargetWords(queue.cards, learning),
      errors,
    };
  }, []);

  useReloadOnWake(reload);

  if (!scenario) return null;

  // Without data yet there is no "now" to read, so the planned-days line simply waits for the first load.
  const days = data ? plannedDays(data.now) : null;
  const done = data ? doneMinutes(data.loggedMinutes, running === "konusma" ? elapsedSeconds : 0) : 0;
  const isRunning = running === "konusma";

  async function onHeroAction() {
    setMessage("");
    try {
      await timer.toggle("konusma");
      if (!isRunning) setStep("2");
    } catch {
      setMessage("Süre kaydedilemedi. Tekrar dene.");
    }
  }

  return (
    <section aria-labelledby="konusma-screen-title" className="flex min-w-0 flex-col gap-3.5 break-words">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="konusma-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
            Konuşma
          </h1>
        </div>
        {days ? (
          <p className="text-small leading-[1.35] text-muted">
            {plannedDaysLine(days)}
            {isPlannedToday(days) ? "" : ". Bugün planlı gün değil, istersen yine de konuşabilirsin"}.
          </p>
        ) : null}
      </header>

      {data ? (
        <SkillHero
          block="konusma"
          doneMinutes={done}
          planMinutes={data.plan}
          runningSeconds={isRunning ? elapsedSeconds : null}
          title="Konuşma"
          subtitle={scenario.title}
          chips={[heroRemaining(done, data.plan)]}
          actionLabel={isRunning ? `Durdur · ${formatMMSS(elapsedSeconds)}` : "Konuşmaya başla"}
          actionAriaLabel={isRunning ? "Konuşma sayacını durdur" : "Konuşma sayacını başlat"}
          onAction={onHeroAction}
          detail={days ? (
            <p>
              {plannedDaysLine(days)}
              {isPlannedToday(days) ? "" : ". Bugün planlı gün değil, istersen yine de konuşabilirsin"}.
            </p>
          ) : undefined}
        />
      ) : null}
      <LiveRegion visible>{message}</LiveRegion>
      {!data && error ? <LoadError onRetry={reload} /> : null}

      <SegmentedControl
        aria-label="Oturum adımı"
        className="border-border bg-raised [&_button]:min-h-12 [&_button]:transition-[translate,box-shadow] [&_button:active]:translate-y-0.5 [&_button:active]:shadow-none [&_button[aria-checked=true]]:border-konusma-mark [&_button[aria-checked=true]]:bg-konusma-tile [&_button[aria-checked=true]]:text-konusma-ink [&_button[aria-checked=true]]:shadow-[0_3px_0_var(--konusma-mark)]"
        options={STEP_OPTIONS}
        value={step}
        onChange={(value) => setStep(value)}
      />

      {step === "1" ? (
        <PrepareStep scenario={scenario} onScenarioChange={setScenarioId} targetWords={data?.targetWords ?? []} />
      ) : null}
      {step === "2" ? <TimerStep /> : null}
      {step === "3" ? (
        <>
          <ReportStep scenarioId={scenario.id} />
          <ErrorLog counts={data?.errors ?? {}} />
        </>
      ) : null}
    </section>
  );
}
