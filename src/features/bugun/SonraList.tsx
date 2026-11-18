import { Panel } from "../../components/ui";
import type { Block } from "../../components/ui";
import { formatMMSS } from "../timer/timerMath";
import { BLOCK_NAMES, NBSP } from "./todayLogic";

export interface SonraRow {
  block: Block;
  /** Second line under the block name. */
  sub: string;
  /** Minutes left in the plan for this block. */
  remainingMinutes: number;
  /** Okuma only: the active book's short name and title for the tile. */
  book?: { shortName: string; title: string };
  /** Kelime only: the number of due cards shown in its tile. */
  dueCards?: number;
}

export interface SonraListProps {
  rows: SonraRow[];
  /** The block whose timer is running (may be a block that is not in `rows`). */
  runningBlock: Block | null;
  runningSeconds: number;
  /** Tapping a row: Kelime opens the review, the others toggle their timer. */
  onPress: (block: Block) => void;
}

const TILE_BASE = "flex shrink-0 items-center justify-center rounded-[5px] border font-semibold";

/** The left slot is always 64px wide so every title starts at the same x. */
function Tile({ row }: { row: SonraRow }) {
  switch (row.block) {
    case "okuma":
      return (
        <span
          role="img"
          aria-label={row.book?.title ?? "Kitap seçilmedi"}
          className={`${TILE_BASE} h-16 w-11 border-okuma-tile-border bg-okuma-tile text-small text-okuma-ink`}
        >
          {row.book?.shortName}
        </span>
      );
    case "kelime":
      return (
        <span
          aria-hidden="true"
          className={`${TILE_BASE} size-11 border-kelime-tile-border bg-kelime-tile text-body text-kelime-ink`}
        >
          {row.dueCards}
        </span>
      );
    case "dinleme":
      // A pale green 16:9 tile (64 x 36): a placeholder for the video thumbnail.
      return (
        <span
          aria-hidden="true"
          className={`${TILE_BASE} h-9 w-16 border-dinleme-tile-border bg-dinleme-tile`}
        />
      );
    case "konusma":
      return (
        <span
          aria-hidden="true"
          className={`${TILE_BASE} size-11 border-konusma-tile-border bg-konusma-tile`}
        />
      );
  }
}

/** The "Sonra" list: the blocks that are not in the hero card. */
export function SonraList({ rows, runningBlock, runningSeconds, onPress }: SonraListProps) {
  return (
    <section aria-labelledby="sonra-heading" className="flex flex-col gap-1.5">
      <h2 id="sonra-heading" className="text-small font-semibold text-muted">
        Sonra
      </h2>
      <Panel padding="none" clip className="flex flex-col">
        {rows.map((row) => {
          const isRunning = runningBlock === row.block;
          const isTimerRow = row.block !== "kelime";
          return (
            <button
              key={row.block}
              type="button"
              onClick={() => onPress(row.block)}
              aria-pressed={isTimerRow ? isRunning : undefined}
              className="flex min-h-[72px] w-full items-center gap-3 border-t border-rule px-4 py-1 text-left first:border-t-0 transition-[background-color] duration-120 active:bg-rule focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text"
            >
              <span className="flex w-16 shrink-0 items-center justify-center">
                <Tile row={row} />
              </span>
              <span className="block min-w-0 flex-1">
                <span className="block text-body leading-tight font-semibold text-text">
                  {BLOCK_NAMES[row.block]}
                </span>
                <span className="mt-0.5 block text-small leading-[1.3] text-muted">{row.sub}</span>
              </span>
              {isRunning ? (
                <span className="num block shrink-0 text-right text-small font-semibold whitespace-nowrap text-text">
                  {formatMMSS(runningSeconds)} · Durdur
                </span>
              ) : (
                <span className="block shrink-0 text-right text-small font-medium whitespace-nowrap text-muted">
                  {row.remainingMinutes}
                  {NBSP}dk kaldı
                </span>
              )}
            </button>
          );
        })}
      </Panel>
    </section>
  );
}
