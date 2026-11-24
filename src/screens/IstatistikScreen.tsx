// İstatistik screen with today's skill rings and repository-backed statistics.
// every sentence and size is decided in src/features/istatistik/statsLogic.ts (pure, tested).

import { Button, LoadError, Panel, ProgressTrack } from "../components/ui";
import type { Block } from "../components/ui";
import { SKILL_BLOCKS, toLocalDay } from "../data";
import type { SkillBlock } from "../data";
import { useRepoData } from "../data/react";
import { useReloadOnWake } from "../features/time/useReloadOnWake";
import { formatHoursMinutes } from "../features/dinleme/logic/listening";
import {
  LISTENING_GOAL_HOURS,
  NBSP,
  bandRows,
  buildMonthGrid,
  buildWeekColumns,
  consistencyText,
  goalLabel,
  listeningProjectionText,
  monthlyByBlock,
  percent,
  rangeOfLastDays,
  reviewRateText,
  speakingRows,
  sumBands,
  weeklyByBlock,
} from "../features/istatistik/statsLogic";
import { BLOCK_NAMES } from "../features/bugun/todayLogic";
import { SkillMiniRing } from "../features/skill/SkillMiniRing";
import { doneMinutes } from "../features/okuma/logic";
import { useTimer } from "../features/timer/TimerProvider";

// Full literal class names so Tailwind can find them (never built from a template string).
const SEGMENT_BG: Record<SkillBlock, string> = {
  okuma: "bg-okuma-mark",
  kelime: "bg-kelime-mark",
  dinleme: "bg-dinleme-mark",
  konusma: "bg-konusma-mark",
};

function goBack() {
  window.location.hash = "#/bugun";
}

function Kpi({ label, value, block }: { label: string; value: string; block?: Block }) {
  const subColor = block === "dinleme" ? "text-dinleme-ink" : block === "kelime" ? "text-kelime-ink" : "text-muted";
  return (
    <Panel tactile padding="sm" className="flex min-h-27 min-w-0 flex-col justify-between gap-2">
      <span className={`text-small ${subColor}`}>{label}</span>
      <span className={`num break-words leading-tight ${value.includes(" ") && value.length > 8 ? "text-section" : "text-title"} font-semibold tracking-tight text-text`}>{value}</span>
    </Panel>
  );
}

function BarRow({
  label,
  valueText,
  value,
  max,
  block,
}: {
  label: string;
  valueText: string;
  value: number;
  max: number;
  block: Block;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-small">
        <span className="font-semibold">{label}</span>
        <span className="num whitespace-nowrap">{valueText}</span>
      </div>
      <ProgressTrack
        value={value}
        max={max}
        size="md"
        block={block}
        label={label}
        valueText={valueText}
      />
    </div>
  );
}

export function IstatistikScreen() {
  const timer = useTimer();
  const { data, error, reload } = useRepoData(async (repo) => {
    const today = toLocalDay();
    const range = rangeOfLastDays(today, 30);
    const [settings, days, consistency, listeningTotal, words, bands, success, leeches, speaking, todayMinutes] = await Promise.all([
      repo.settings.get(),
      repo.stats.minutesPerBlockPerDay(range),
      repo.stats.consistency(today),
      repo.stats.totalListeningMinutes(),
      repo.stats.wordCounts(),
      repo.stats.knownWordsPerNgslBand(),
      repo.stats.reviewSuccessRate(today),
      repo.stats.leechCount(),
      repo.stats.speakingErrorsWeekOverWeek(today),
      repo.activity.minutesPerBlockForDay(today),
    ]);
    return { today, settings, days, consistency, listeningTotal, words, bands, success, leeches, speaking, todayMinutes };
  }, []);

  // "Today" and the 30-day range are fixed at load time; refresh them across midnight.
  useReloadOnWake(reload);

  const header = (
    <>
      <Button variant="text"
        onClick={goBack}
        aria-label="Bugün ekranına dön"
        className="self-start pr-3 font-semibold"
      >
        ‹ Bugün
      </Button>
      <header className="flex flex-col gap-1">
        <h1 id="istatistik-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          İstatistik
        </h1>
        <p className="text-small leading-[1.35] text-muted">
          Dolu kutu: o gün en az {data?.settings.dailyMinimumMinutes ?? 20}
          {NBSP}dk çalışıldı. Boş kutu sadece boş gündür.
        </p>
      </header>
    </>
  );

  if (error) {
    return (
      <section aria-labelledby="istatistik-screen-title" className="flex flex-col gap-3.5">
        {header}
        <LoadError onRetry={reload} />
      </section>
    );
  }
  if (!data) {
    return (
      <section aria-labelledby="istatistik-screen-title" className="flex flex-col gap-3.5">
        {header}
      </section>
    );
  }

  const { today, settings, days, consistency, listeningTotal, words, bands, success, leeches, speaking } = data;
  const minimum = settings.dailyMinimumMinutes;
  const week = buildWeekColumns(days, minimum, today);
  const weekly = weeklyByBlock(days, settings.blockPlanMinutes);
  const monthly = monthlyByBlock(days, settings.blockPlanMinutes);
  const grid = buildMonthGrid(days, minimum);
  const bandList = bandRows(bands);
  const bandMax = Math.max(1, ...bandList.map((row) => row.known));
  const goalMinutes = LISTENING_GOAL_HOURS * 60;
  const speakingList = speakingRows(speaking);
  const speakingMax = Math.max(1, ...speakingList.flatMap((row) => [row.thisWeek, row.lastWeek]));
  const noActivityYet = days.every((entry) => SKILL_BLOCKS.every((block) => entry.minutes[block] === 0));

  return (
    <section aria-labelledby="istatistik-screen-title" className="flex flex-col gap-3.5">
      {header}

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-bugun" className="flex min-w-0 flex-col gap-4">
        <h2 id="ist-bugun" className="text-section font-semibold leading-tight">
          Bugün dört beceri
        </h2>
        <div className="grid grid-cols-2 gap-y-4 min-[360px]:grid-cols-4">
          {SKILL_BLOCKS.map((block) => (
            <SkillMiniRing
              key={block}
              block={block}
              label={BLOCK_NAMES[block]}
              doneMinutes={doneMinutes(data.todayMinutes[block], timer.running === block ? timer.elapsedSeconds : 0)}
              planMinutes={settings.blockPlanMinutes[block]}
            />
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2.5">
        <Kpi label="Toplam dinleme" value={formatHoursMinutes(listeningTotal)} block="dinleme" />
        <Kpi label="Bilinen kelime" value={String(sumBands(bands))} block="kelime" />
        <Kpi label="Hatırladım, son 7 gün" value={reviewRateText(success)} block="kelime" />
        <Kpi label="Sorunlu kelime" value={String(leeches)} />
      </div>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-hafta" className="flex flex-col gap-3.5">
        <h2 id="ist-hafta" className="text-section leading-[1.2] font-semibold tracking-[-0.01em]">
          Bu hafta
        </h2>
        <ul className="grid grid-cols-7 items-end gap-2">
          {week.columns.map((column) => (
            <li key={column.day} className="flex flex-col items-center gap-1 text-[12px] text-muted">
              <div
                role="img"
                aria-label={column.ariaLabel}
                className="relative flex h-30 w-full flex-col-reverse overflow-hidden rounded-md bg-rule"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 z-[2] border-t-2 border-dashed border-text opacity-80"
                  style={{ bottom: `${week.minimumLinePercent}%` }}
                />
                {column.segments.map((segment) => (
                  <span
                    key={segment.block}
                    aria-hidden="true"
                    className={`block w-full border-t-2 border-surface first:border-t-0 ${SEGMENT_BG[segment.block]}`}
                    style={{ height: `${segment.heightPercent}%`, display: segment.minutes > 0 ? "block" : "none" }}
                  />
                ))}
              </div>
              <span>{column.label}</span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-muted" aria-label="Renkler">
          {SKILL_BLOCKS.map((block) => (
            <li key={block} className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className={`inline-block size-2.5 rounded-[3px] ${SEGMENT_BG[block]}`} />
              {BLOCK_NAMES[block]}
            </li>
          ))}
        </ul>
        <p className="text-small leading-[1.35] text-muted">
          {noActivityYet
            ? "Son 30 günde kayıtlı çalışma yok."
            : `Kesik çizgi: ${minimum}${NBSP}dk. Her kolon günün blok dağılımı.`}
        </p>
        <div className="flex flex-col gap-3.5">
          {weekly.map((row) => (
            <BarRow
              key={row.block}
              label={BLOCK_NAMES[row.block]}
              valueText={`${row.done}${NBSP}/${NBSP}${row.plan}${NBSP}dk`}
              value={row.done}
              max={row.plan}
              block={row.block}
            />
          ))}
        </div>
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-ay" className="flex flex-col gap-3.5">
        <h2 id="ist-ay" className="text-section font-semibold leading-tight">Son 30 gün</h2>
        {monthly.map((row) => (
          <BarRow key={row.block} label={BLOCK_NAMES[row.block]}
            valueText={`${row.done}${NBSP}/${NBSP}${row.plan}${NBSP}dk`}
            value={row.done} max={row.plan} block={row.block} />
        ))}
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-duzen" className="flex flex-col gap-3.5">
        <h2 id="ist-duzen" className="text-section leading-[1.2] font-semibold tracking-[-0.01em]">
          Düzen
        </h2>
        <p className="text-small leading-[1.35] text-muted">
          Soldan sağa, satır satır: otuz gün önceden bugüne. Dolu kutu {minimum}
          {NBSP}dk karşılandı, boş kutu karşılanmadı.
        </p>
        <ul aria-label="Son 30 gün" className="grid grid-cols-10 gap-1">
          {grid.map((cell) => (
            <li
              key={cell.day}
              role="img"
              aria-label={cell.ariaLabel}
              className={`aspect-square rounded-md border-2 ${cell.met ? "border-text bg-text" : "border-muted"}`}
            />
          ))}
        </ul>
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-body font-semibold">Son 7 gün</b>
          <span className="num">{consistencyText(consistency.last7, 7)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-body font-semibold">Son 30 gün</b>
          <span className="num">{consistencyText(consistency.last30, 30)}</span>
        </div>
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-dinleme" className="flex flex-col gap-3.5">
        <h2 id="ist-dinleme" className="text-section leading-[1.2] font-semibold tracking-[-0.01em]">
          Dinleme hedefi
        </h2>
        <BarRow
          label={goalLabel(LISTENING_GOAL_HOURS)}
          valueText={`%${percent(Math.min(listeningTotal, goalMinutes), goalMinutes)}`}
          value={listeningTotal}
          max={goalMinutes}
          block="dinleme"
        />
        <p className="text-small leading-[1.35] text-muted">
          {listeningProjectionText(listeningTotal, LISTENING_GOAL_HOURS, days, today)}
        </p>
        
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-kelime" className="flex flex-col gap-3.5">
        <h2 id="ist-kelime" className="text-section leading-[1.2] font-semibold tracking-[-0.01em]">
          Kelime aralıkları
        </h2>
        <div className="flex flex-col gap-3.5">
          {bandList.map((row) => (
            <BarRow
              key={row.band}
              label={row.label}
              valueText={String(row.known)}
              value={row.known}
              max={bandMax}
              block="kelime"
            />
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-body font-semibold">Öğreniliyor</b>
          <span className="num">{words.learning}</span>
        </div>
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="ist-konusma" className="flex flex-col gap-3.5">
        <h2 id="ist-konusma" className="text-section leading-[1.2] font-semibold tracking-[-0.01em]">
          Konuşma hataları
        </h2>
        {speakingList.length === 0 ? (
          <p className="text-small leading-[1.35] text-muted">Son iki haftada kayıtlı konuşma hatası yok.</p>
        ) : (
          <>
            <p className="text-small leading-[1.35] text-muted">Bu hafta çubukta, geçen hafta yazıda.</p>
            <ul>
              {speakingList.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 border-t border-rule py-2.5 first:border-t-0 first:pt-0">
                  <div className="flex justify-between gap-3 text-small">
                    <b className="font-semibold">{row.label}</b>
                    <span className="text-[12px] text-muted">{row.delta}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_28px] items-center gap-2">
                    <ProgressTrack
                      value={row.thisWeek}
                      max={speakingMax}
                      size="md"
                      block="konusma"
                      label={`${row.label}, bu hafta`}
                      valueText={`${row.thisWeek} hata`}
                    />
                    <span className="num text-right text-small font-semibold">{row.thisWeek}</span>
                  </div>
                  <span className="num text-[12px] text-muted">Geçen hafta {row.lastWeek}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <p className="pb-2 text-[12px] leading-[1.4] text-muted">
        Kelime listesi: New General Service List (NGSL) 1.2, Browne, C., Culligan, B. ve Phillips, J., CC BY-SA 4.0
        lisansı ile. https://www.newgeneralservicelist.com Listeden yalnızca sözcükler alınmış ve JSON biçimine
        çevrilmiştir.
      </p>
    </section>
  );
}
