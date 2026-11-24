import { Panel } from "../../components/ui/index.ts";
import { errorBarRows, totalErrors } from "./logic/session.ts";

/** "Hata kaydı, bu hafta": rose bars, but the counts are plain ink text so they read well. */
export function ErrorLog({ counts }: { counts: Readonly<Record<string, number>> }) {
  const total = totalErrors(counts);
  const rows = errorBarRows(counts);
  return (
    <Panel tactile as="section" padding="sm" aria-labelledby="konusma-log-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="konusma-log-heading" className="text-section leading-[1.25] font-semibold text-text">
          Hata kaydı, bu hafta
        </h2>
        <span className="text-small font-semibold whitespace-nowrap text-text tabular-nums">{total} hata</span>
      </div>
      {total === 0 ? <p className="text-small leading-[1.35] text-muted">Bu hafta kayıtlı hata yok.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small font-medium text-text">{row.label}</span>
              <span className="text-small font-semibold text-text tabular-nums">{row.count}</span>
            </div>
            <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-control">
              <div className="h-full rounded-full bg-konusma-mark" style={{ width: `${row.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
