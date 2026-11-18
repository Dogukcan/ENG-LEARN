import { useEffect, useRef } from "react";
import { Button, Panel, SegmentedControl } from "../../components/ui/index.ts";
import type { SegmentedOption } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { Book } from "../../data";
import { useTimer } from "../timer/TimerProvider.tsx";
import { formatClock, stepValue } from "./logic.ts";
import { Stepper } from "./Stepper.tsx";

export interface BookPanelProps {
  books: readonly Book[];
  activeBook: Book;
}

/**
 * Book switch, current book panel (tile, title, position, steppers) and the reading timer button.
 */
export function BookPanel({ books, activeBook }: BookPanelProps) {
  const { running, elapsedSeconds, toggle } = useTimer();
  const reading = running === "okuma";

  const options: Array<SegmentedOption<string>> = books.map((book) => ({ value: book.id, label: book.shortName }));

  // Fast taps on + must not lose steps. Each tap reads the position from `latest` (updated at once),
  // not from props (updated only after the database write and reload). Writes run one after another
  // through `chain`, so an older write can never land after a newer one.
  const latest = useRef({ unit: activeBook.unit, page: activeBook.page });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const bookIdRef = useRef(activeBook.id);

  // Adopt the stored position when nothing is being written (first load, book switch, other screens).
  useEffect(() => {
    if (pending.current === 0 || bookIdRef.current !== activeBook.id) {
      bookIdRef.current = activeBook.id;
      latest.current = { unit: activeBook.unit, page: activeBook.page };
    }
  }, [activeBook.id, activeBook.unit, activeBook.page]);

  function step(field: "unit" | "page", delta: 1 | -1) {
    const next = { ...latest.current, [field]: stepValue(latest.current[field], delta) };
    if (next.unit === latest.current.unit && next.page === latest.current.page) return;
    latest.current = next;
    const bookId = activeBook.id;
    pending.current += 1;
    chain.current = chain.current
      .then(() => repository.books.setPosition(bookId, next))
      .catch(() => undefined)
      .finally(() => {
        pending.current -= 1;
      });
  }

  return (
    <>
      <SegmentedControl
        aria-label="Kitap seçimi"
        options={options}
        value={activeBook.id}
        onChange={(bookId) => {
          void repository.settings.update({ activeBookId: bookId });
        }}
      />

      <Panel padding="sm" className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <span
            role="img"
            aria-label={activeBook.title}
            className="flex h-16 w-11 shrink-0 items-center justify-center rounded-[5px] border border-okuma-tile-border bg-okuma-tile text-small font-semibold text-okuma-ink"
          >
            {activeBook.shortName}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-body leading-[1.25] font-semibold text-text">{activeBook.title}</h2>
            <p className="text-small leading-[1.3] text-muted">
              Ünite {activeBook.unit} · sayfa {activeBook.page}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-rule pt-3">
          <Stepper label="Sayfa" value={activeBook.page} onStep={(delta) => step("page", delta)} />
          <Stepper label="Ünite" value={activeBook.unit} onStep={(delta) => step("unit", delta)} />
        </div>
      </Panel>

      <Button
        variant="primary-block"
        block="okuma"
        aria-pressed={reading}
        className={reading ? "tabular-nums" : undefined}
        onClick={() => {
          void toggle("okuma");
        }}
      >
        {reading ? `${formatClock(elapsedSeconds)} · Durdur` : "Okumaya başla"}
      </Button>
    </>
  );
}
