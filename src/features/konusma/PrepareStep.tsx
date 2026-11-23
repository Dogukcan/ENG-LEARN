import { useEffect, useRef, useState } from "react";
import { Button, LiveRegion, Panel, cx } from "../../components/ui/index.ts";
import { buildPrompt } from "./logic/buildPrompt.ts";
import { ERROR_CATEGORY_IDS } from "./logic/errorCategories.ts";
import { SCENARIOS } from "./logic/scenarios.ts";
import type { Scenario } from "./logic/scenarios.ts";
import { copyText, selectElementText } from "./copyText.ts";

interface PrepareStepProps {
  scenario: Scenario;
  onScenarioChange: (id: string) => void;
  targetWords: readonly string[];
}

const COPIED_MS = 2500;

/** Step 1: choose the scenario, see its tasks, copy the prompt for the AI voice mode. */
export function PrepareStep({ scenario, onScenarioChange, targetWords }: PrepareStepProps) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewRef = useRef<HTMLPreElement>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  // Clear the "Kopyalandı" timer when the step is left, so it never sets state after unmount.
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const prompt = buildPrompt({ scenario, targetWords, trackedCategories: ERROR_CATEGORY_IDS });

  async function onCopy() {
    const ok = await copyText(prompt);
    window.clearTimeout(resetTimer.current);
    if (ok) {
      setCopied(true);
      setStatus("Prompt panoya kopyalandı. ChatGPT ya da Gemini sesli moduna yapıştır.");
      resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      return;
    }
    // Clipboard is blocked: show the prompt and select it so the learner can copy it by hand.
    setCopied(false);
    setStatus("Kopyalanamadı. Promptu gösterdik ve seçtik, sistem menüsünden kopyala.");
    setPreviewOpen(true);
    window.setTimeout(() => {
      if (previewRef.current) selectElementText(previewRef.current);
    }, 0);
  }

  return (
    <>
      <section aria-labelledby="konusma-scenario-heading" className="flex flex-col gap-2">
        <h2 id="konusma-scenario-heading" className="text-section leading-[1.25] font-semibold text-text">
          Senaryo
        </h2>
        <div role="group" aria-label="Senaryo seçimi" className="grid grid-cols-2 gap-2">
          {SCENARIOS.map((item) => {
            const selected = item.id === scenario.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onScenarioChange(item.id)}
                className={cx(
                  "flex min-h-[104px] flex-col justify-between gap-2 rounded-[14px] border-2 p-3 text-left",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
                  selected ? "border-text bg-konusma-tile text-konusma-ink" : "border-transparent bg-surface text-text",
                )}
              >
                <span className="text-body leading-[1.25] font-semibold">{item.title}</span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cx("text-small leading-[1.3]", selected ? "text-konusma-ink" : "text-muted")}>
                    {item.kind}
                  </span>
                  {selected ? <span className="text-small font-bold whitespace-nowrap">Seçili</span> : null}
                </span>
              </button>
            );
          })}
        </div>
        <Panel padding="sm" className="flex flex-col gap-2">
          <h3 className="text-small font-semibold text-muted">3 görev (İngilizce, promptta aynen geçer)</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body leading-[1.4] text-text">
            {scenario.tasks.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ol>
          <p className="text-small leading-[1.35] text-muted">Bitiş: {scenario.endCondition}</p>
        </Panel>
      </section>

      <Panel as="section" padding="sm" aria-labelledby="konusma-prompt-heading" className="flex flex-col gap-3">
        <h2 id="konusma-prompt-heading" className="text-section leading-[1.25] font-semibold text-text">
          Prompt
        </h2>
        <p className="text-small leading-[1.35] text-muted">
          B1 seviyesi · {targetWords.length} hedef kelime · {ERROR_CATEGORY_IDS.length} hata kategorisi · 3 görev
        </p>
        {targetWords.length > 0 ? (
          <p className="text-small leading-[1.35] text-text">Bugünün hedef kelimeleri: {targetWords.join(", ")}.</p>
        ) : null}
        <Button
          variant="neutral"
          onClick={onCopy}
          className={copied ? "border-konusma-mark bg-konusma-tile text-konusma-ink" : undefined}
        >
          {copied ? "Kopyalandı" : "Promptu kopyala"}
        </Button>
        <LiveRegion visible>{status}</LiveRegion>
        <Button
          variant="text"
          aria-expanded={previewOpen}
          aria-controls="konusma-prompt-preview"
          onClick={() => setPreviewOpen((open) => !open)}
          className="self-start"
        >
          {previewOpen ? "Promptu gizle" : "Promptu göster"}
        </Button>
        {/* tabIndex 0 so a keyboard user can scroll the long text and select it. */}
        <pre
          id="konusma-prompt-preview"
          ref={previewRef}
          tabIndex={0}
          hidden={!previewOpen}
          className="max-h-72 overflow-auto rounded-control bg-raised p-3 text-small leading-[1.45] break-words whitespace-pre-wrap text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
        >
          {prompt}
        </pre>
      </Panel>
    </>
  );
}
