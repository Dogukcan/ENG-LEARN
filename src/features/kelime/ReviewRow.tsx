import { Button, DisabledReason, Panel } from "../../components/ui/index.ts";
import type { ReviewQueue } from "../../data";

export interface ReviewRowProps {
  queue: ReviewQueue;
  onStart: () => void;
}

const NBSP = " ";

/** Compact review row: how many cards wait, the time estimate and the start button. */
export function ReviewRow({ queue, onStart }: ReviewRowProps) {
  const empty = queue.cards.length === 0;
  return (
    <Panel as="section" aria-label="Kelime tekrar özeti" padding="none" className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-[48px] items-center justify-between gap-3">
        <span className="text-small leading-[1.35] font-semibold text-text">
          {queue.dueTotal}
          {NBSP}kart · tahmini {queue.estimatedMinutes}
          {NBSP}dk
        </span>
        <Button
          variant="primary-block"
          block="kelime"
          onClick={onStart}
          disabled={empty}
          aria-describedby={empty ? "kelime-review-reason" : undefined}
          // The shared primary button is 56px and full width; here it is the 44px compact version with the 10px control radius of the draft.
          className="h-11! w-auto! shrink-0 rounded-control! px-4 text-small!"
        >
          Tekrara başla
        </Button>
      </div>
      {empty ? <DisabledReason id="kelime-review-reason">Şu an tekrar edilecek kart yok.</DisabledReason> : null}
    </Panel>
  );
}
