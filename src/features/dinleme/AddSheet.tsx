import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, SegmentedControl, Sheet, TextField } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { NewActivityLog, VideoLevel } from "../../data";
import {
  EXTERNAL_MINUTES_ERROR_TEXT,
  LEVEL_OPTIONS,
  LINK_ERROR_TEXT,
  MINUTES_ERROR_TEXT,
  parseMinutes,
  thumbnailUrl,
} from "./logic/screen.ts";
import { fetchOEmbed, parseYouTubeId } from "./logic/youtube.ts";
import type { OEmbedInfo } from "./logic/youtube.ts";
import { VideoThumb } from "./VideoThumb.tsx";

type SheetTab = "link" | "ext";

const TAB_OPTIONS = [
  { value: "link", label: "Link ekle" },
  { value: "ext", label: "Dışarıda dinledim" },
] as const;

/** Focus a field on the next tick: the native dialog is not open yet while the form first mounts. */
function useFocusSoon(ref: React.RefObject<HTMLInputElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [ref, active]);
}

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; info: OEmbedInfo }
  | { state: "failed" };

interface LinkFormProps {
  active: boolean;
  onAdded: (message: string) => void;
}

/**
 * "Link ekle": URL -> automatic title lookup -> title, minutes, level.
 * The lookup is only a convenience. If it fails (offline, private video) the title field stays
 * empty and the user types it, so adding a video never depends on the network.
 */
function LinkForm({ active, onAdded }: LinkFormProps) {
  const urlRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("");
  const [level, setLevel] = useState<VideoLevel>("orta");
  const [urlError, setUrlError] = useState("");
  const [titleError, setTitleError] = useState("");
  const [minutesError, setMinutesError] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  // True once the user typed in the title field: a late lookup answer must not overwrite their text.
  const titleTouched = useRef(false);

  useFocusSoon(urlRef, active);

  const youtubeId = parseYouTubeId(url);

  // Look the video up whenever the pasted link names a (new) video id.
  useEffect(() => {
    if (youtubeId === null) {
      setLookup({ state: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ state: "loading" });
    void fetchOEmbed(url).then((result) => {
      // A newer link replaced this one while we waited: drop the stale answer.
      if (cancelled) return;
      if (result.ok) {
        setLookup({ state: "ok", info: result.info });
        if (!titleTouched.current) setTitle(result.info.title);
      } else {
        setLookup({ state: "failed" });
      }
    });
    return () => {
      cancelled = true;
    };
    // `url` is read for the request but `youtubeId` is the real trigger: typing a "&t=30" suffix
    // must not start a second lookup for the same video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setUrlError("");
    setTitleError("");
    setMinutesError("");

    const id = parseYouTubeId(url);
    const trimmedTitle = title.trim();
    const parsedMinutes = parseMinutes(minutes);
    // Collect the first bad field so focus goes there, in reading order.
    let firstBad: HTMLInputElement | null = null;
    if (id === null) {
      setUrlError(LINK_ERROR_TEXT.invalid);
      firstBad = urlRef.current;
    }
    if (id !== null && trimmedTitle === "") {
      setTitleError("Videonun başlığını yaz.");
      firstBad ??= titleRef.current;
    }
    if (parsedMinutes === null) {
      setMinutesError(MINUTES_ERROR_TEXT);
      firstBad ??= minutesRef.current;
    }
    if (firstBad || id === null || parsedMinutes === null) {
      firstBad?.focus();
      return;
    }

    savingRef.current = true;
    try {
      const channel = lookup.state === "ok" ? lookup.info.author_name : "";
      const result = await repository.videos.add({
        youtubeId: id,
        title: trimmedTitle,
        channel,
        level,
        durationMinutes: parsedMinutes,
      });
      if (!result.ok) {
        setUrlError(LINK_ERROR_TEXT.duplicate);
        urlRef.current?.focus();
        return;
      }
      onAdded(`Video eklendi: ${parsedMinutes} dk.`);
    } finally {
      savingRef.current = false;
    }
  }

  const lookupText =
    lookup.state === "loading"
      ? "Başlık aranıyor…"
      : lookup.state === "failed"
        ? "Başlık YouTube'dan alınamadı. Başlığı kendin yaz."
        : "";

  return (
    <form onSubmit={handleSubmit} noValidate hidden={!active} className="flex flex-col gap-3">
      <TextField
        ref={urlRef}
        label="YouTube linki"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        placeholder="youtube.com/watch?v=…"
        textSize="large"
        value={url}
        error={urlError}
        onChange={(event) => setUrl(event.target.value)}
      />
      {youtubeId !== null ? (
        <div className="flex flex-col gap-1.5">
          <div className="w-40">
            {/* The tile is shown while loading and on failure; the picture appears only when the lookup gave one. */}
            <VideoThumb
              key={lookup.state === "ok" ? lookup.info.thumbnail_url ?? thumbnailUrl(youtubeId) : "tile"}
              youtubeId={youtubeId}
              title={title.trim() || "seçilen video"}
              durationText=""
              size="full"
              src={lookup.state === "ok" ? lookup.info.thumbnail_url ?? thumbnailUrl(youtubeId) : undefined}
            />
          </div>
          <p role="status" className="text-small leading-[1.35] text-muted">
            {lookupText}
          </p>
        </div>
      ) : null}
      <TextField
        ref={titleRef}
        label="Başlık"
        autoComplete="off"
        value={title}
        error={titleError}
        onChange={(event) => {
          titleTouched.current = true;
          setTitle(event.target.value);
        }}
      />
      <TextField
        ref={minutesRef}
        label="Süre (dakika)"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ör. 12"
        value={minutes}
        error={minutesError}
        onChange={(event) => setMinutes(event.target.value)}
      />
      <SegmentedControl
        aria-label="Seviye"
        options={LEVEL_OPTIONS}
        value={level}
        onChange={setLevel}
      />
      <Button type="submit" variant="primary-block" block="dinleme">
        Ekle
      </Button>
    </form>
  );
}

interface ExternalFormProps {
  active: boolean;
  onAdded: (message: string) => void;
}

/** "Dışarıda dinledim": minutes heard away from the app (podcast, a talk) become manual Dinleme minutes. */
function ExternalForm({ active, onAdded }: ExternalFormProps) {
  const minutesRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState("");

  // Move focus here when the user switches to this tab (not on first mount: the link tab is first).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (active) minutesRef.current?.focus();
  }, [active]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const parsed = parseMinutes(minutes);
    if (parsed === null) {
      setError(EXTERNAL_MINUTES_ERROR_TEXT);
      minutesRef.current?.focus();
      return;
    }
    savingRef.current = true;
    try {
      setError("");
      // The session is stamped "now": the repository files it under today's local day.
      const input: NewActivityLog = {
        block: "dinleme",
        startedAt: new Date().toISOString(),
        seconds: parsed * 60,
        source: "manual",
      };
      await repository.activity.add(input);
      onAdded(`Dışarıda dinlenen ${parsed} dk eklendi.`);
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate hidden={!active} className="flex flex-col gap-3">
      <TextField
        ref={minutesRef}
        label="Kaç dakika?"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ör. 30"
        textSize="large"
        value={minutes}
        error={error}
        onChange={(event) => setMinutes(event.target.value)}
      />
      <Button type="submit" variant="neutral">
        Kaydet
      </Button>
    </form>
  );
}

interface AddSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save with the message for the status line. */
  onAdded: (kind: SheetTab, message: string) => void;
}

/**
 * The content of the sheet. It owns the tab state and is mounted only while the sheet is open
 * (the Sheet renders its children only then), so every opening starts on "Link ekle".
 * Both forms stay mounted while it is open (the inactive one is `hidden`), so switching tabs
 * never loses typed text.
 */
function SheetBody({ onClose, onAdded }: Omit<AddSheetProps, "open">) {
  const [tab, setTab] = useState<SheetTab>("link");
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button variant="text" onClick={onClose}>
          Vazgeç
        </Button>
        <h2 className="text-section leading-[1.25] font-semibold text-text">Ekle</h2>
        <span aria-hidden="true" className="w-[68px]" />
      </div>
      <SegmentedControl aria-label="Ne eklemek istiyorsun?" options={TAB_OPTIONS} value={tab} onChange={setTab} />
      <LinkForm active={tab === "link"} onAdded={(message) => onAdded("link", message)} />
      <ExternalForm active={tab === "ext"} onAdded={(message) => onAdded("ext", message)} />
    </>
  );
}

/** The bottom sheet behind the round "+" button. */
export function AddSheet({ open, onClose, onAdded }: AddSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} aria-label="Ekle" dismissOnBackdrop={false}>
      <SheetBody onClose={onClose} onAdded={onAdded} />
    </Sheet>
  );
}
