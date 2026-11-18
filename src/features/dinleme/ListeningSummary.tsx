import { Panel, ProgressTrack } from "../../components/ui/index.ts";
import { formatHoursMinutes } from "./logic/listening.ts";
import {
  BAR_DAYS,
  LISTENING_GOAL_HOURS,
  barsLabel,
  buildBars,
  forecastText,
  goalPercent,
  paceFromDayMinutes,
} from "./logic/screen.ts";

const NBSP = "\u00A0";

interface ListeningSummaryProps {
  /** All listening minutes ever logged (whole minutes). */
  totalMinutes: number;
  /** Minutes per day for the last 14 local days, oldest first. */
  dayMinutes: readonly number[];
  /** Today's planned Dinleme minutes: the dashed line in the chart. */
  planMinutes: number;
  now: Date;
}

/**
 * The hero panel of variant 2: total listening beside the goal, the goal bar, the 14-day bars
 * and two numbers (projected date, daily average). Everything shown is computed from the props.
 */
export function ListeningSummary({ totalMinutes, dayMinutes, planMinutes, now }: ListeningSummaryProps) {
  const percent = goalPercent(totalMinutes, LISTENING_GOAL_HOURS);
  const pace = paceFromDayMinutes(dayMinutes);
  const forecast = forecastText(totalMinutes, LISTENING_GOAL_HOURS, pace, now);
  const { bars, planPercent } = buildBars(dayMinutes, planMinutes);

  return (
    <Panel as="section" aria-label="Toplam dinleme" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-small leading-[1.25] font-semibold text-dinleme-ink">Toplam dinleme</span>
          <p className="text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] text-text tabular-nums">
            {formatHoursMinutes(totalMinutes).replace(/ /g, NBSP)}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-right">
          <span className="text-small leading-[1.35] text-muted">Hedef {LISTENING_GOAL_HOURS}{NBSP}sa</span>
          <span className="text-body leading-[1.3] font-semibold text-text tabular-nums">%{percent}</span>
        </div>
      </div>

      <ProgressTrack
        block="dinleme"
        size="md"
        label="Hedefe ilerleme"
        value={totalMinutes}
        max={LISTENING_GOAL_HOURS * 60}
        valueText={`${formatHoursMinutes(totalMinutes)}, hedefin yüzde ${percent}'i`}
      />

      <div>
        <div
          role="img"
          aria-label={barsLabel(dayMinutes, planMinutes)}
          className="relative flex h-14 items-end gap-[3px]"
        >
          {bars.map((bar, index) => (
            <div
              key={index}
              className={bar.minutes > 0 ? "min-h-0.5 flex-1 rounded-t-[3px] bg-dinleme-mark" : "h-0.5 flex-1 bg-track-empty"}
              style={bar.minutes > 0 ? { height: `${bar.heightPercent}%` } : undefined}
            />
          ))}
          {/* Dashed line = the day's planned minutes. Purely visual: the label above says it in words. */}
          <div
            className="pointer-events-none absolute right-0 left-0 h-0 border-t border-dashed border-muted"
            style={{ bottom: `${planPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[12px] text-muted">
          <span>{BAR_DAYS} gün önce</span>
          <span>Bugün</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-rule pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-small leading-[1.35] text-muted">Tahmini tarih</span>
          <span className="text-body leading-[1.3] font-semibold text-text tabular-nums">{forecast.date}</span>
          <span className="text-small leading-[1.35] text-muted">{forecast.note}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-small leading-[1.35] text-muted">Günlük ortalama</span>
          <span className="text-body leading-[1.3] font-semibold text-text tabular-nums">
            {Math.round(pace)}{NBSP}dk
          </span>
        </div>
      </div>
    </Panel>
  );
}
