import type { Block } from "../../components/ui";
import { NBSP, STRIP_GAP_PX } from "./todayLogic";
import type { StripGeometry } from "./todayLogic";

const FILL: Record<Block, string> = {
  okuma: "bg-okuma-mark",
  kelime: "bg-kelime-mark",
  dinleme: "bg-dinleme-mark",
  konusma: "bg-konusma-mark",
};

export interface DayStripProps {
  geometry: StripGeometry;
  /** Spoken summary, e.g. "Okuma 22/35 dk, ..., toplam 36/95 dk". */
  summary: string;
  minimum: number;
  minimumMet: boolean;
  remainingMinutes: number;
}

/**
 * The day strip: one 12px track made of four segments (one per block). Each segment is as wide as
 * its planned minutes, so the whole track is the full plan. A small tick marks the daily minimum.
 */
export function DayStrip({ geometry, summary, minimum, minimumMet, remainingMinutes }: DayStripProps) {
  const { segments, tick, gapsTotal } = geometry;
  // 100% of the track minus the gaps is shared by the segments, so the tick uses the same maths.
  const tickLeft = `calc((100% - ${gapsTotal}px) * ${tick.fraction} + ${tick.gapsBefore * STRIP_GAP_PX}px)`;

  return (
    <section aria-label={summary} className="flex flex-col gap-1.5">
      <div className="relative py-0.5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-[2] flex items-center"
          style={{ left: tickLeft }}
        >
          <span className="h-4 w-0.5 rounded-[1px] bg-text" />
        </div>
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-md">
          {segments.map((segment) => (
            <div
              key={segment.block}
              className="relative h-3 overflow-hidden bg-track-empty"
              style={{ flex: segment.flex }}
            >
              <div className={`h-full ${FILL[segment.block]}`} style={{ width: `${segment.fillPercent}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-small text-muted">
          {minimumMet ? `${minimum}${NBSP}dk minimum tamam` : `minimum ${minimum}${NBSP}dk`}
        </span>
        <span className="num text-body font-semibold text-text">{remainingMinutes}{NBSP}dk kaldı</span>
      </div>
    </section>
  );
}
