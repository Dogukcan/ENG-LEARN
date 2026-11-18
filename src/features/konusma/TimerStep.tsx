import { useState } from "react";
import { Button, Panel } from "../../components/ui/index.ts";
import { formatClock } from "../okuma/logic.ts";
import { useTimer } from "../timer/TimerProvider.tsx";

const BLOCK_NAME = { okuma: "Okuma", kelime: "Kelime", dinleme: "Dinleme", konusma: "Konuşma" } as const;

/** Step 2: the big Konuşma timer. It is the shared app timer, so Bugün shows the same clock. */
export function TimerStep() {
  const { running, elapsedSeconds, toggle } = useTimer();
  const [failure, setFailure] = useState("");
  const isRunning = running === "konusma";
  const other = running !== null && running !== "konusma" ? BLOCK_NAME[running] : null;

  async function onToggle() {
    setFailure("");
    try {
      await toggle("konusma");
    } catch {
      setFailure("Süre kaydedilemedi. Sayaç çalışmaya devam ediyor, Durdur'a tekrar bas.");
    }
  }

  let help = "Önce promptu kopyalayıp sesli moda yapıştır, sonra süreyi başlat.";
  if (isRunning) help = "ChatGPT ya da Gemini sesli modunda konuşuyorsun. İşin bitince Durdur'a bas.";
  else if (other) help = `${other} sayacı çalışıyor. Başlatırsan o durur ve süresi kaydedilir.`;

  return (
    <Panel as="section" padding="md" aria-labelledby="konusma-timer-heading" className="flex flex-col gap-4">
      <h2 id="konusma-timer-heading" className="text-section leading-[1.25] font-semibold text-text">
        Konuşma süresi
      </h2>
      {/* aria-live off: a clock that announces every second would drown the screen reader. */}
      <p
        role="timer"
        aria-live="off"
        className="text-center text-[56px] leading-none font-semibold tracking-[-0.02em] text-konusma-ink tabular-nums"
      >
        {formatClock(isRunning ? elapsedSeconds : 0)}
      </p>
      <p className="text-small leading-[1.35] text-muted">{help}</p>
      <Button variant="primary-block" block="konusma" aria-pressed={isRunning} onClick={onToggle}>
        {isRunning ? "Durdur" : "Konuşmaya başla"}
      </Button>
      <p role="alert" className="text-small font-medium text-negative empty:hidden">
        {failure}
      </p>
    </Panel>
  );
}
