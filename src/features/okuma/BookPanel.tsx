import { useEffect, useRef } from "react";
import { Panel, SegmentedControl } from "../../components/ui/index.ts";
import type { SegmentedOption } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { Book } from "../../data";
import { stepValue } from "./logic.ts";
import { Stepper } from "./Stepper.tsx";

export interface BookPanelProps {
  books: readonly Book[];
  activeBook: Book;
}

/** Book switch and position controls; queued writes preserve rapid page steps. */
export function BookPanel({ books, activeBook }: BookPanelProps) {
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
      <Panel tactile as="section" padding="sm" aria-labelledby="okuma-book-heading" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="okuma-book-heading" className="text-section font-semibold text-text">Kitap</h2>
          <span className="text-small text-muted">Basılı kitabın yanında</span>
        </div>
        <SegmentedControl
          aria-label="Kitap seçimi"
          options={options}
          value={activeBook.id}
          className="border-border bg-raised [&_button]:active:translate-y-0.5 [&_button]:active:shadow-none [&_button]:transition-[translate,box-shadow] [&_button[aria-checked=true]]:shadow-[0_3px_0_var(--border)]"
          onChange={(bookId) => {
            void repository.settings.update({ activeBookId: bookId });
          }}
        />
      </Panel>

      <Panel tactile as="section" padding="sm" aria-labelledby="okuma-position-heading" className="flex flex-col gap-3.5">
        <h2 id="okuma-position-heading" className="text-section font-semibold text-text">Kaldığın yer</h2>
        <Stepper label="Ünite" value={activeBook.unit} onStep={(delta) => step("unit", delta)} />
        <Stepper label="Sayfa" value={activeBook.page} onStep={(delta) => step("page", delta)} />
      </Panel>
    </>
  );
}
