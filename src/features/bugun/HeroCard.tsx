import { Button, Panel } from "../../components/ui";
import type { Block } from "../../components/ui";
import { formatMMSS } from "../timer/timerMath";
import { BLOCK_NAMES } from "./todayLogic";

// Full literal class names so Tailwind can find them (it cannot see `text-${block}-ink`).
const KICKER_INK: Record<Block, string> = {
  okuma: "text-okuma-ink",
  kelime: "text-kelime-ink",
  dinleme: "text-dinleme-ink",
  konusma: "text-konusma-ink",
};

export interface HeroCardProps {
  block: Block;
  /** The big figure, e.g. "38 kart" or "13 dk kaldı". */
  kpi: string;
  /** The grey line under the figure. */
  meta: string;
  /** Seconds of the running timer when THIS block is running, otherwise null. */
  runningSeconds: number | null;
  /** Kelime opens the review session; the other blocks toggle the timer. */
  onPress: () => void;
}

/** The "Sıradaki" card: one block, one big button. */
export function HeroCard({ block, kpi, meta, runningSeconds, onPress }: HeroCardProps) {
  const isTimerBlock = block !== "kelime";
  const isRunning = isTimerBlock && runningSeconds !== null;

  let label: string;
  if (!isTimerBlock) label = "Tekrara başla";
  else if (isRunning) label = `${formatMMSS(runningSeconds)} · Durdur`;
  else label = `${BLOCK_NAMES[block]} başlat`;

  return (
    <Panel as="section" aria-label="Sıradaki çalışma bloğu" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <span className={`text-small leading-tight font-semibold ${KICKER_INK[block]}`}>
          Sıradaki: {BLOCK_NAMES[block]}
        </span>
        <p className="text-kpi leading-[1.1] font-semibold tracking-[-0.02em] text-text">
          {kpi}
        </p>
        <p className="text-body leading-[1.35] text-muted">{meta}</p>
      </div>
      <Button
        variant="primary-block"
        block={block}
        onClick={onPress}
        // aria-pressed only for the timer blocks: it tells a screen reader "this is a toggle".
        aria-pressed={isTimerBlock ? isRunning : undefined}
        className={isRunning ? "num" : undefined}
      >
        {label}
      </Button>
    </Panel>
  );
}
