import { useEffect, useState } from "react";
import { Button, LiveRegion, Panel, TextArea } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { SaveReportResult, SpeakingReport } from "../../data";
import { categoryLabel, wordsLine } from "./logic/session.ts";
import { loadReportDraft, saveReportDraft } from "./logic/sessionState.ts";
import { parseReport } from "./logic/reportSchema.ts";

interface ReportStepProps {
  scenarioId: string;
}

interface Processed {
  report: SpeakingReport;
  saved: SaveReportResult;
}

/** Step 3: paste the AI's JSON report, check it, save it, and show what was found. */
export function ReportStep({ scenarioId }: ReportStepProps) {
  // The pasted text survives a reload and a step change until it is processed (see logic/sessionState.ts).
  const [text, setText] = useState(loadReportDraft);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<Processed | null>(null);
  // The text that was already saved. "İşle" stays off for the same text, so one report can never
  // be counted twice by a double tap.
  const [savedText, setSavedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    // After a successful save the draft is cleared, so the old report is not offered again.
    saveReportDraft(savedText !== null && savedText === text ? "" : text);
  }, [text, savedText]);

  const alreadySaved = savedText !== null && savedText === text;
  const disabled = busy || alreadySaved;

  async function onProcess() {
    if (disabled) return;
    setStatus("");
    const parsed = parseReport(text);
    if (!parsed.ok) {
      setProblem(parsed.message);
      setResult(null);
      return;
    }
    setProblem("");
    setBusy(true);
    try {
      const saved = await repository.speaking.saveReport(
        { scenarioId, startedAt: new Date().toISOString() },
        parsed.report,
      );
      setResult({ report: parsed.report, saved });
      setSavedText(text);
      setStatus(`${saved.errorsSaved} hata bu haftanın kaydına eklendi.`);
    } catch {
      setProblem("Rapor kaydedilemedi. Metin yerinde duruyor, tekrar dene.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel as="section" padding="sm" aria-labelledby="konusma-report-heading" className="flex flex-col gap-3">
        <h2 id="konusma-report-heading" className="text-section leading-[1.25] font-semibold text-text">
          Raporu yapıştır
        </h2>
        <TextArea
          label="Yapay zekanın verdiği JSON raporu"
          rows={7}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          // No text-small here: below 16px iOS Safari zooms the page when the field is focused.
          className="font-mono"
        />
        <Button variant="neutral" disabled={disabled} onClick={onProcess}>
          {alreadySaved ? "İşlendi" : "İşle"}
        </Button>
        <div role="alert" className="empty:hidden">
          {problem ? (
            <p className="rounded-control bg-pill-negative-bg p-3 text-small leading-[1.4] font-medium text-pill-negative-ink">
              <span className="font-semibold">Rapor işlenemedi. </span>
              {problem}
            </p>
          ) : null}
        </div>
        <LiveRegion visible>{status}</LiveRegion>
      </Panel>

      {result ? <Results processed={result} /> : null}
    </>
  );
}

function Results({ processed }: { processed: Processed }) {
  const { report, saved } = processed;
  return (
    <>
      <Panel as="section" padding="sm" aria-labelledby="konusma-res-errors" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="konusma-res-errors" className="text-section leading-[1.25] font-semibold text-text">
            Hatalar
          </h2>
          <span className="text-small font-semibold text-text tabular-nums">{report.errors.length}</span>
        </div>
        {report.errors.length === 0 ? (
          <p className="text-small text-muted">Bu oturumda kayıtlı hata yok.</p>
        ) : (
          <ul className="flex flex-col">
            {report.errors.map((error, index) => (
              <li key={index} className="flex flex-col gap-0.5 py-2.5 not-first:border-t not-first:border-rule">
                <span className="text-small leading-[1.35] text-muted line-through">{error.original}</span>
                <span className="text-body leading-[1.35] font-semibold text-text">→ {error.corrected}</span>
                <span className="text-small font-medium text-konusma-ink">{categoryLabel(error.category)}</span>
                {error.note ? <span className="text-small leading-[1.35] text-muted">{error.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {report.betterPhrases.length > 0 ? (
        <Panel as="section" padding="sm" aria-labelledby="konusma-res-phrases" className="flex flex-col gap-3">
          <h2 id="konusma-res-phrases" className="text-section leading-[1.25] font-semibold text-text">
            Daha iyi ifadeler
          </h2>
          <ul className="flex flex-col">
            {report.betterPhrases.map((phrase, index) => (
              <li key={index} className="flex flex-col gap-0.5 py-2.5 not-first:border-t not-first:border-rule">
                <span className="text-small leading-[1.35] text-muted">{phrase.original}</span>
                <span className="text-body leading-[1.35] font-semibold text-text">→ {phrase.better}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel as="section" padding="sm" aria-labelledby="konusma-res-words" className="flex flex-col gap-2">
        <h2 id="konusma-res-words" className="text-section leading-[1.25] font-semibold text-text">
          Yeni kelimeler
        </h2>
        <p className="text-body leading-[1.4] text-text">{wordsLine(saved.wordsAdded, saved.wordsSkipped)}</p>
        {report.summary ? <p className="text-small leading-[1.4] text-muted">{report.summary}</p> : null}
      </Panel>
    </>
  );
}
