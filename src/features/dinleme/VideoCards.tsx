import { useEffect, useRef } from "react";
import { Button, Panel } from "../../components/ui/index.ts";
import type { Video, VideoUnderstanding } from "../../data";
import { levelLabel, UNDERSTANDING_OPTIONS, understandingLabel } from "./logic/screen.ts";
import { VideoThumb } from "./VideoThumb.tsx";
import { watchUrl } from "./logic/youtube.ts";

const NBSP = "\u00A0";

const OPEN_LINK_CLASS =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-control border border-border bg-surface px-2 text-center text-small font-semibold text-text shadow-[0_4px_0_var(--border)] " +
  "transition-[translate,box-shadow,background-color] duration-120 active:translate-y-[3px] active:shadow-none active:bg-control " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text";

function VideoInfo({ video, extra }: { video: Video; extra?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-body leading-[1.25] font-semibold wrap-anywhere text-text">{video.title}</p>
      {video.channel ? <p className="text-small leading-[1.3] wrap-anywhere text-muted">{video.channel}</p> : null}
      <p className="text-small leading-[1.3] text-muted tabular-nums">
        {levelLabel(video.level)} · {video.durationMinutes}
        {NBSP}dk{extra ? ` · ${extra}` : ""}
      </p>
    </div>
  );
}

/** "YouTube'da aç": a real link that opens a new tab. noopener keeps the new page from reaching back. */
function OpenLink({ video }: { video: Video }) {
  return (
    <a
      href={watchUrl(video.youtubeId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`YouTube'da aç: ${video.title} (yeni sekmede açılır)`}
      className={OPEN_LINK_CLASS}
    >
      YouTube&apos;da aç
    </a>
  );
}

interface TodoCardProps {
  video: Video;
  asking: boolean;
  onAsk: () => void;
  onCancelAsk: () => void;
  onWatched: (understanding: VideoUnderstanding) => void;
}

/** One card of the "İzlenecek" list: picture, texts, two actions, and the inline question. */
function TodoCard({ video, asking, onAsk, onCancelAsk, onWatched }: TodoCardProps) {
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Focus follows the question: into it when it opens, back to "İzledim" when it is cancelled.
  useEffect(() => {
    if (asking) firstOptionRef.current?.focus();
    else if (wasAsking.current) askButtonRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const titleId = `ask-${video.id}`;
  return (
    <li>
      <Panel tactile as="article" padding="sm" className="flex min-w-0 flex-col gap-3">
        <VideoThumb youtubeId={video.youtubeId} title={video.title} durationText={`${video.durationMinutes}${NBSP}dk`} size="full" />
        <VideoInfo video={video} />
        <div className="grid grid-cols-2 gap-2">
          <OpenLink video={video} />
          <Button tactile
            ref={askButtonRef}
            type="button"
            aria-expanded={asking}
            onClick={onAsk}
            className="h-11 text-small"
          >
            İzledim
          </Button>
        </div>
        {asking ? (
          <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2 border-t border-rule pt-2.5">
            <p id={titleId} className="text-small font-semibold text-text">
              Ne kadar anladın?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {UNDERSTANDING_OPTIONS.map((option, index) => (
                <Button tactile
                  key={option.value}
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="button"
                  onClick={() => onWatched(option.value)}
                  className="h-11 text-small"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Button tactile variant="text" onClick={onCancelAsk} className="self-start underline underline-offset-[3px]">
              Vazgeç
            </Button>
          </div>
        ) : null}
      </Panel>
    </li>
  );
}

interface TodoListProps {
  videos: readonly Video[];
  askingId: string | null;
  onAsk: (id: string) => void;
  onCancelAsk: () => void;
  onWatched: (id: string, understanding: VideoUnderstanding) => void;
}

export function TodoList({ videos, askingId, onAsk, onCancelAsk, onWatched }: TodoListProps) {
  if (videos.length === 0) {
    return (
      <Panel tactile padding="sm">
        <p className="text-small leading-[1.4] text-muted">İzlenecek video yok. Bir YouTube linki ekle.</p>
      </Panel>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {videos.map((video) => (
        <TodoCard
          key={video.id}
          video={video}
          asking={askingId === video.id}
          onAsk={() => onAsk(video.id)}
          onCancelAsk={onCancelAsk}
          onWatched={(understanding) => onWatched(video.id, understanding)}
        />
      ))}
    </ul>
  );
}

export function WatchedList({ videos }: { videos: readonly Video[] }) {
  if (videos.length === 0) {
    return (
      <Panel tactile padding="sm">
        <p className="text-small leading-[1.4] text-muted">Henüz izlenen video yok.</p>
      </Panel>
    );
  }
  return (
    <Panel tactile padding="none" clip>
      <ul>
        {videos.map((video) => (
          <li key={video.id} className="flex flex-col gap-2.5 border-t border-rule px-4 py-3.5 first:border-t-0">
            <div className="flex items-start gap-3">
              <VideoThumb youtubeId={video.youtubeId} title={video.title} durationText="" size="small" />
              <VideoInfo
                video={video}
                extra={video.understanding ? `Anlama: ${understandingLabel(video.understanding)}` : undefined}
              />
            </div>
            <OpenLink video={video} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
