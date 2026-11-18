import { useEffect, useRef, useState } from "react";
import { Button, SegmentedControl } from "../components/ui/index.ts";
import { addLocalDays, repository, toLocalDay } from "../data";
import type { VideoUnderstanding } from "../data";
import { useRepoData } from "../data/react";
import { AddSheet } from "../features/dinleme/AddSheet.tsx";
import { ListeningSummary } from "../features/dinleme/ListeningSummary.tsx";
import { BAR_DAYS, doneWithRunning, formatDoneOfPlan, listCountText } from "../features/dinleme/logic/screen.ts";
import { TodoList, WatchedList } from "../features/dinleme/VideoCards.tsx";
import { useTimer } from "../features/timer/TimerProvider.tsx";

type ListTab = "todo" | "watched";

/** What the quiet status line shows. `undoId` is set only right after "İzledim". */
interface Status {
  text: string;
  undoId: string | null;
}

/**
 * Dinleme screen, variant 2 "Sekmeli": a summary panel, one list at a time (İzlenecek / İzlendi)
 * and a bottom sheet to add a link or minutes heard outside the app. This component loads the
 * data and arranges the pieces; the pieces live in src/features/dinleme and the rules in logic/.
 * The Dinleme timer is not on this screen (the draft has none): it stays on Bugün.
 */
export function DinlemeScreen() {
  const { running, elapsedSeconds } = useTimer();
  const [listTab, setListTab] = useState<ListTab>("todo");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [askingId, setAskingId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  const { data, error } = useRepoData(async (repo) => {
    const now = new Date();
    const today = toLocalDay(now);
    const [settings, todo, watched, total, days] = await Promise.all([
      repo.settings.get(),
      repo.videos.listByStatus("todo"),
      repo.videos.listByStatus("watched"),
      repo.stats.totalListeningMinutes(),
      repo.stats.minutesPerBlockPerDay({ from: addLocalDays(today, -(BAR_DAYS - 1)), to: today }),
    ]);
    const dayMinutes = days.map((day) => day.minutes.dinleme);
    return {
      now,
      plan: settings.blockPlanMinutes.dinleme,
      todo,
      watched,
      total,
      dayMinutes,
      todayMinutes: dayMinutes[dayMinutes.length - 1] ?? 0,
    };
  }, []);

  // The card that held focus is gone after "İzledim", so move focus to "Geri al" (as the draft does).
  // An effect (not a timeout) runs after React has really drawn the button.
  const undoId = status?.undoId ?? null;
  useEffect(() => {
    if (undoId) undoRef.current?.focus();
  }, [undoId]);

  async function handleWatched(id: string, understanding: VideoUnderstanding) {
    const result = await repository.videos.markWatched(id, understanding);
    setAskingId(null);
    if (!result.ok) {
      setStatus({ text: "Bu video artık listede değil.", undoId: null });
      return;
    }
    setStatus({
      text: `İzlendi listesine taşındı: ${result.video.title}. +${result.video.durationMinutes} dk eklendi.`,
      undoId: id,
    });
  }

  async function handleUndo(id: string) {
    const result = await repository.videos.undoWatched(id);
    setStatus(
      result.ok
        ? { text: "Geri alındı. Video İzlenecek listesine döndü.", undoId: null }
        : { text: "Geri alınamadı.", undoId: null },
    );
  }

  const done = data ? doneWithRunning(data.todayMinutes, running === "dinleme" ? elapsedSeconds : 0) : 0;
  const tabOptions = [
    { value: "todo", label: `İzlenecek (${data?.todo.length ?? 0})` },
    { value: "watched", label: `İzlendi (${data?.watched.length ?? 0})` },
  ] as const;
  const shown = listTab === "todo" ? data?.todo : data?.watched;
  const shownMinutes = shown?.reduce((sum, video) => sum + video.durationMinutes, 0) ?? 0;

  return (
    <section aria-labelledby="dinleme-screen-title" className="flex flex-col gap-3.5">
      <header className="flex items-center justify-between gap-3">
        <h1 id="dinleme-screen-title" className="text-title leading-[1.15] font-semibold tracking-[-0.02em] text-text">
          Dinleme
        </h1>
        <div className="inline-flex items-center gap-2.5">
          {data ? (
            <span className="text-right text-body font-semibold whitespace-nowrap text-text tabular-nums">
              {formatDoneOfPlan(done, data.plan)}
            </span>
          ) : null}
          <Button variant="icon" aria-label="Link ya da dakika ekle" onClick={() => setSheetOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round]">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-small font-medium text-negative">
          Veriler okunamadı. Sayfayı yenile.
        </p>
      ) : null}

      {/* Mounted from the start and only its text changes: a live region that appears together with its text is often not announced. */}
      <div
        role="status"
        aria-live="polite"
        className={status ? "flex items-center justify-between gap-2 px-0.5 text-small text-muted" : "sr-only"}
      >
        <span>{status?.text}</span>
        {status?.undoId ? (
          <button
            ref={undoRef}
            type="button"
            onClick={() => void handleUndo(status.undoId ?? "")}
            className="inline-flex min-h-11 shrink-0 items-center px-2 text-small font-semibold text-text underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
          >
            Geri al
          </button>
        ) : null}
      </div>

      {data ? (
        <>
          <ListeningSummary totalMinutes={data.total} dayMinutes={data.dayMinutes} planMinutes={data.plan} now={data.now} />
          <SegmentedControl aria-label="Video listesi" options={tabOptions} value={listTab} onChange={setListTab} />
          <p className="text-small leading-[1.35] text-muted tabular-nums">{listCountText(shown?.length ?? 0, shownMinutes)}</p>
          {listTab === "todo" ? (
            <TodoList
              videos={data.todo}
              askingId={askingId}
              onAsk={setAskingId}
              onCancelAsk={() => setAskingId(null)}
              onWatched={(id, understanding) => void handleWatched(id, understanding)}
            />
          ) : (
            <WatchedList videos={data.watched} />
          )}
        </>
      ) : null}

      <AddSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onAdded={(kind, message) => {
          setSheetOpen(false);
          setStatus({ text: message, undoId: null });
          if (kind === "link") setListTab("todo");
        }}
      />
    </section>
  );
}
