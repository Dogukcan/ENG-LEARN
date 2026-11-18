import { useState } from "react";
import { SegmentedControl } from "../components/ui/index.ts";
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
import { doneMinutes, titleProgress } from "../features/okuma/logic.ts";
import { useTimer } from "../features/timer/TimerProvider.tsx";

type Step = "1" | "2" | "3";

const STEP_OPTIONS = [
  { value: "1", label: "1 Hazırlan" },
  { value: "2", label: "2 Konuş" },
  { value: "3", label: "3 Rapor" },
] as const;

/**
 * Konuşma screen, variant 2 "Adımlar". This component loads the data and picks the step;
 * the steps live in src/features/konusma and the pure rules in its logic/ folder.
 */
export function KonusmaScreen() {
  const { running, elapsedSeconds } = useTimer();
  const [step, setStep] = useState<Step>("1");
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0]?.id ?? "");
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];

  // Reloaded after every repository write: a stopped timer, a saved report.
  const { data } = useRepoData(async (repo) => {
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

  if (!scenario) return null;

  // Without data yet there is no "now" to read, so the planned-days line simply waits for the first load.
  const days = data ? plannedDays(data.now) : null;
  const done = data ? doneMinutes(data.loggedMinutes, running === "konusma" ? elapsedSeconds : 0) : 0;

  return (
    <section aria-labelledby="konusma-screen-title" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="konusma-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
            Konuşma
          </h1>
          {data ? (
            <span className="text-body font-semibold whitespace-nowrap text-text tabular-nums">
              {titleProgress(done, data.plan)}
            </span>
          ) : null}
        </div>
        {days ? (
          <p className="text-small leading-[1.35] text-muted">
            {plannedDaysLine(days)}
            {isPlannedToday(days) ? "" : ". Bugün planlı gün değil, istersen yine de konuşabilirsin"}.
          </p>
        ) : null}
      </header>

      <SegmentedControl
        aria-label="Oturum adımı"
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
