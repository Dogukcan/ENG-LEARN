import { Panel } from "../../components/ui/index.ts";
import type { CapturedRow } from "./logic.ts";

/** "Bugün yakalananlar": a plain list, newest first, or one quiet line when there is nothing yet. */
export function CapturedToday({ rows }: { rows: readonly CapturedRow[] }) {
  return (
    <section aria-labelledby="okuma-captured-heading" className="flex flex-col gap-2">
      <h2 id="okuma-captured-heading" className="text-section leading-[1.25] font-semibold text-text">
        Bugün yakalananlar
      </h2>
      <Panel padding="none" clip>
        {rows.length === 0 ? (
          <p className="p-4 text-small text-muted">Bugün henüz kelime yakalamadın.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 not-first:border-t not-first:border-rule"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body leading-[1.25] font-semibold text-text">{row.word}</span>
                  {row.sentence ? (
                    <span className="text-small leading-[1.35] break-words text-muted">{row.sentence}</span>
                  ) : null}
                </div>
                <span className="shrink-0 text-small whitespace-nowrap text-muted">{row.sourceLine}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
