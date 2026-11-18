// Bugün (Today) screen, draft D. This component loads data and joins the pieces; the rules live in
// src/features/bugun/todayLogic.ts (pure, tested) and the look lives in the small components next to it.

import { useState } from "react";
import { LiveRegion, LoadError } from "../components/ui";
import type { Block } from "../components/ui";
import { SKILL_BLOCKS } from "../data";
import type { Book, SkillBlock } from "../data";
import { useRepoData } from "../data/react";
import { DayStrip } from "../features/bugun/DayStrip";
import { HeroCard } from "../features/bugun/HeroCard";
import { SonraList } from "../features/bugun/SonraList";
import type { SonraRow } from "../features/bugun/SonraList";
import {
  BLOCK_NAMES,
  NBSP,
  bookLine,
  computeStrip,
  countWorkedDays,
  dinlemeLine,
  displayMinutes,
  findingLine,
  konusmaLine,
  lastLocalDays,
  pickNextBlock,
  reviewMinutes,
} from "../features/bugun/todayLogic";
import type { MinutesByBlock } from "../features/bugun/todayLogic";
import { pickTargetWords } from "../features/konusma/logic/session";
import { AccountButton } from "../features/hesap/AccountSheet";
import { useReloadOnWake } from "../features/time/useReloadOnWake";
import { useTimer } from "../features/timer/TimerProvider";
import { ReviewSession } from "../features/review/ReviewSession";
import { recordReviewMinutes } from "../features/review/recordReview";

const DAYS_IN_CONSISTENCY_LINE = 7;

const sumMinutes = (minutes: MinutesByBlock): number =>
  SKILL_BLOCKS.reduce((sum, block) => sum + minutes[block], 0);

export function BugunScreen() {
  const timer = useTimer();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [message, setMessage] = useState("");

  // Everything the screen needs, in one load. useRepoData reloads it after any repository write,
  // for example when the timer saves its session, so the numbers update by themselves.
  const { data, error, reload } = useRepoData(async (repo) => {
    const now = new Date();
    const days = lastLocalDays(now, DAYS_IN_CONSISTENCY_LINE);
    const [settings, queue, books, perDay, videos, learning] = await Promise.all([
      repo.settings.get(),
      repo.cards.getReviewQueue(now),
      repo.books.list(),
      Promise.all(days.map((day) => repo.activity.minutesPerBlockForDay(day))),
      repo.videos.listByStatus("todo"),
      repo.words.listByStatus("learning"),
    ]);
    return { settings, queue, books, perDay, videos, learning };
  }, []);

  // "Today", the 7-day strip and the due count are computed at load time, so reload when the app wakes
  // up (an iPhone PWA stays in memory overnight) and every minute.
  useReloadOnWake(reload);

  if (!data) {
    // Nothing to show for the first few milliseconds; the title keeps the layout from jumping.
    return (
      <section aria-labelledby="bugun-screen-title" className="flex flex-col gap-3.5">
        <h1 id="bugun-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Bugün
        </h1>
        {error ? <LoadError onRetry={reload} /> : null}
      </section>
    );
  }

  const { settings, queue, books, perDay, videos, learning } = data;
  const targetWords = pickTargetWords(queue.cards, learning);
  const plan = settings.blockPlanMinutes;

  // Today is the last item of `perDay`. The running timer is not saved yet, so its live minutes
  // are added on top. Doing this at render time keeps the numbers moving without extra writes.
  const stored = perDay[perDay.length - 1];
  const liveMinutes = timer.running ? timer.elapsedSeconds / 60 : 0;
  const done = {} as MinutesByBlock;
  for (const block of SKILL_BLOCKS) {
    done[block] = displayMinutes(stored[block] + (timer.running === block ? liveMinutes : 0));
  }
  const totalDone = sumMinutes(done);
  const totalPlan = sumMinutes(plan);
  const minimum = settings.dailyMinimumMinutes;
  const target = settings.dailyTargetMinutes;
  const minimumMet = totalDone >= minimum;

  const next = pickNextBlock({ doneMinutes: done, planMinutes: plan, dueTotal: queue.dueTotal });
  const remaining = (block: SkillBlock) => Math.max(0, plan[block] - done[block]);

  const activeBook: Book | undefined = books.find((book) => book.id === settings.activeBookId) ?? books[0];
  const okumaLine = activeBook ? bookLine(activeBook) : "Kitap seçilmedi";

  const strip = computeStrip({ planMinutes: plan, doneMinutes: done, minimum });
  const stripSummary =
    SKILL_BLOCKS.map((block) => `${BLOCK_NAMES[block]} ${done[block]}/${plan[block]} dk`).join(", ") +
    `, toplam ${totalDone}/${totalPlan} dk`;

  // Days worked: the stored totals of the other days, plus today's live total.
  const dayTotals = perDay.map((minutes, index) =>
    index === perDay.length - 1 ? totalDone : sumMinutes(minutes),
  );
  const workedDays = countWorkedDays(dayTotals, minimum);

  const sub: Record<SkillBlock, string> = {
    okuma: okumaLine,
    kelime: `${queue.dueTotal}${NBSP}kart · ${queue.newToday}${NBSP}yeni kart`,
    dinleme: dinlemeLine(videos),
    konusma: konusmaLine(targetWords.length),
  };

  const heroKpi =
    next === "kelime" ? `${queue.dueTotal}${NBSP}kart` : `${remaining(next)}${NBSP}dk kaldı`;
  const heroMeta =
    next === "kelime"
      ? `tahmini ${reviewMinutes(queue.cards.length, queue.estimatedMinutes)}${NBSP}dk · ${queue.newToday}${NBSP}yeni kart`
      : sub[next];

  const rows: SonraRow[] = SKILL_BLOCKS.filter((block) => block !== next).map((block) => ({
    block,
    sub: sub[block],
    remainingMinutes: remaining(block),
    book: block === "okuma" && activeBook ? { shortName: activeBook.shortName, title: activeBook.title } : undefined,
    dueCards: block === "kelime" ? queue.dueTotal : undefined,
    videoMinutes: block === "dinleme" ? videos[0]?.durationMinutes : undefined,
    targetWords: block === "konusma" ? targetWords.length : undefined,
  }));

  // A failed save leaves the timer running (see TimerProvider), so we only need to tell the user.
  const run = (action: Promise<void>) => {
    setMessage("");
    action.catch(() => setMessage("Süre kaydedilemedi. Tekrar dene."));
  };

  const openReview = () => {
    // One timer rule: the review session and a running timer must not run at the same time.
    const stopFirst = timer.running ? timer.stop() : Promise.resolve();
    run(stopFirst.then(() => setReviewOpen(true)));
  };

  const press = (block: Block) => {
    if (block === "kelime") openReview();
    else run(timer.toggle(block));
  };

  return (
    <section aria-labelledby="bugun-screen-title" className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h1 id="bugun-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
            Bugün
          </h1>
          <div className="flex items-center gap-3">
            <span className="num text-body font-semibold whitespace-nowrap text-text">
              {totalDone}
              {NBSP}/{NBSP}
              {target}
              {NBSP}dk
            </span>
            {/* Importing the account button also starts the sync engine (see features/sync/runtime.ts). */}
            <AccountButton />
          </div>
        </div>
        <p className="text-small leading-[1.35] text-muted">{findingLine({ totalDone, minimum, next })}</p>
      </header>

      <HeroCard
        block={next}
        kpi={heroKpi}
        meta={heroMeta}
        runningSeconds={timer.running === next ? timer.elapsedSeconds : null}
        onPress={() => press(next)}
      />

      <DayStrip
        geometry={strip}
        summary={stripSummary}
        minimum={minimum}
        minimumMet={minimumMet}
        remainingMinutes={Math.max(0, target - totalDone)}
      />

      <SonraList rows={rows} runningBlock={timer.running} runningSeconds={timer.elapsedSeconds} onPress={press} />

      {/* Setting the hash is enough: until the İstatistik screen exists the app falls back to Bugün. */}
      <button
        type="button"
        onClick={() => {
          window.location.hash = "#/istatistik";
        }}
        className="flex min-h-11 items-center self-start text-left text-small text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
      >
        Son {DAYS_IN_CONSISTENCY_LINE}
        {NBSP}günde {workedDays}
        {NBSP}gün çalıştın{NBSP}›
      </button>

      <LiveRegion visible>{message || (timer.capped ? "Sayaç 3 saati geçti; 180 dk kaydedildi." : "")}</LiveRegion>

      <ReviewSession
        open={reviewOpen}
        onClose={(summary) => {
          setReviewOpen(false);
          // The write makes useRepoData reload, so the strip and the next-block rule move on.
          recordReviewMinutes(summary).catch(() => setMessage("Süre kaydedilemedi. Tekrar dene."));
        }}
      />
    </section>
  );
}
