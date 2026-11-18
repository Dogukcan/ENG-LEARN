import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, LiveRegion, SegmentedControl, TextArea, TextField } from "../../components/ui/index.ts";
import type { SegmentedOption } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { CaptureSource, NewInboxItem } from "../../data";
import { useRepoData } from "../../data/react";
import { parseAlternatives } from "./sourceLabel.ts";

type SourceKind = "kitap" | "video" | "konusma" | "diger";

const ALL_SOURCE_OPTIONS: ReadonlyArray<SegmentedOption<SourceKind>> = [
  { value: "kitap", label: "Kitap" },
  { value: "video", label: "Video" },
  { value: "konusma", label: "Konuşma" },
  { value: "diger", label: "Diğer" },
];

// The three expected failures of inbox.add, in the user's words.
const ERROR_TEXT = {
  empty: "Kelime boş olamaz.",
  duplicate: "Bu kelime zaten gelen kutusunda.",
  "already-learning": "Bu kelimeyi zaten öğreniyorsun.",
} as const;

export interface AddWordFormProps {
  /** "Vazgeç" and Escape. The parent owns the open state of the Sheet. */
  onClose: () => void;
  /** Called after every successful save, so the screen can reset its one-step undo. */
  onAdded: () => void;
}

/**
 * Content of the full-screen "Kelime ekle" sheet. The Sheet mounts its children only while open,
 * so every opening starts with an empty form. After a save the form clears and stays open, because
 * words usually come in a batch (a page of a book): focus returns to the word field for the next one.
 */
export function AddWordForm({ onClose, onAdded }: AddWordFormProps) {
  const sourceLabelId = useId();
  const wordRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const [word, setWord] = useState("");
  const [sentence, setSentence] = useState("");
  const [meaning, setMeaning] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("diger");
  const [videoLabel, setVideoLabel] = useState("");
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  // The active book gives "Kitap · RW1 · s. 42". Without any book the "Kitap" choice is not offered.
  const { data } = useRepoData(async (repo) => {
    const [settings, books] = await Promise.all([repo.settings.get(), repo.books.list()]);
    return books.find((book) => book.id === settings.activeBookId) ?? books[0];
  }, []);
  const activeBook = data;
  const sourceOptions = activeBook ? ALL_SOURCE_OPTIONS : ALL_SOURCE_OPTIONS.filter((o) => o.value !== "kitap");

  // Focus the word field when the sheet opens. We wait one tick: the Sheet calls showModal() in its
  // own effect, which runs AFTER ours, and a field inside a closed dialog cannot take focus yet.
  useEffect(() => {
    const timer = window.setTimeout(() => wordRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function buildSource(): CaptureSource {
    switch (sourceKind) {
      case "kitap":
        // sourceOptions hides "kitap" without a book, so the book exists here; the fallback is a guard.
        return activeBook ? { kind: "kitap", bookId: activeBook.id, page: activeBook.page } : { kind: "diger" };
      case "video": {
        const label = videoLabel.trim();
        return label ? { kind: "video", label } : { kind: "video" };
      }
      case "konusma":
        return { kind: "konusma" };
      case "diger":
        return { kind: "diger" };
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A double tap on "Kaydet" must not add the word twice while the first save is still running.
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmedSentence = sentence.trim();
      const trimmedMeaning = meaning.trim();
      const alternativeList = parseAlternatives(alternatives);
      const input: NewInboxItem = {
        word,
        source: buildSource(),
        ...(trimmedSentence ? { sentence: trimmedSentence } : {}),
        ...(trimmedMeaning ? { meaningTr: trimmedMeaning } : {}),
        ...(alternativeList.length > 0 ? { alternatives: alternativeList } : {}),
      };
      const result = await repository.inbox.add(input);
      if (!result.ok) {
        setError(ERROR_TEXT[result.reason]);
        wordRef.current?.focus();
        return;
      }
      setError("");
      setLiveMessage(`Eklendi: ${result.item.word}`);
      setWord("");
      setSentence("");
      setMeaning("");
      setAlternatives("");
      setVideoLabel("");
      onAdded();
      wordRef.current?.focus();
    } catch {
      // Why: an unexpected storage failure used to leave the form silently doing nothing.
      setError("Kaydedilemedi. Tekrar dene.");
      wordRef.current?.focus();
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="text" onClick={onClose} className="min-w-[68px]">
          Vazgeç
        </Button>
        <h2 className="text-section leading-[1.25] font-semibold text-text">Kelime ekle</h2>
        <span aria-hidden="true" className="min-w-[68px]" />
      </div>

      <TextField
        ref={wordRef}
        label="Kelime"
        textSize="large"
        placeholder="ör. awkward"
        value={word}
        error={error}
        onChange={(event) => {
          setWord(event.target.value);
          if (error) setError("");
        }}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
      />

      <TextArea
        label="Cümle (isteğe bağlı)"
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
        autoComplete="off"
      />

      <TextField
        label="Anlamı (isteğe bağlı)"
        value={meaning}
        onChange={(event) => setMeaning(event.target.value)}
        autoCapitalize="off"
        autoComplete="off"
      />

      <TextField
        label="Başka yazımı (isteğe bağlı)"
        help="Virgülle ayır. Örnek: harbour"
        value={alternatives}
        onChange={(event) => setAlternatives(event.target.value)}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
      />

      <div className="flex flex-col gap-1.5">
        <span id={sourceLabelId} className="text-small font-medium text-text">
          Nereden?
        </span>
        <SegmentedControl
          aria-labelledby={sourceLabelId}
          options={sourceOptions}
          value={sourceKind}
          onChange={setSourceKind}
        />
        {sourceKind === "kitap" && activeBook ? (
          <p className="text-small leading-[1.35] text-muted">
            {activeBook.shortName} · s. {activeBook.page}
          </p>
        ) : null}
      </div>

      {sourceKind === "video" ? (
        <TextField
          label="Video ya da kanal"
          value={videoLabel}
          onChange={(event) => setVideoLabel(event.target.value)}
          autoComplete="off"
        />
      ) : null}

      <Button type="submit">Kaydet</Button>
      <LiveRegion visible>{liveMessage}</LiveRegion>
    </form>
  );
}
