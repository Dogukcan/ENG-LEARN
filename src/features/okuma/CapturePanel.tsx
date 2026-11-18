import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, LiveRegion, Panel, TextArea, TextField } from "../../components/ui/index.ts";
import { repository } from "../../data";
import type { Book, NewInboxItem } from "../../data";
import { CAPTURE_ERROR_TEXT } from "./logic.ts";

/**
 * "Kelime yakala": the fastest path from a page of the paper book to the inbox.
 * The source is always the active book and its CURRENT page, so the user never types it.
 * After a save the form clears and focus stays in the word field: words come in batches.
 */
export function CapturePanel({ book }: { book: Book }) {
  const wordRef = useRef<HTMLInputElement>(null);
  // A ref (not state) because a second tap can arrive before React re-renders with a "saving" flag.
  const savingRef = useRef(false);

  const [word, setWord] = useState("");
  const [sentence, setSentence] = useState("");
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const trimmedSentence = sentence.trim();
      const input: NewInboxItem = {
        word,
        source: { kind: "kitap", bookId: book.id, page: book.page },
        ...(trimmedSentence ? { sentence: trimmedSentence } : {}),
      };
      const result = await repository.inbox.add(input);
      if (!result.ok) {
        setError(CAPTURE_ERROR_TEXT[result.reason]);
        setLiveMessage("");
        wordRef.current?.focus();
        return;
      }
      setError("");
      setLiveMessage(`Kaydedildi: ${result.item.word}`);
      setWord("");
      setSentence("");
      wordRef.current?.focus();
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <Panel as="section" padding="sm" aria-labelledby="okuma-capture-heading">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <h2 id="okuma-capture-heading" className="text-section leading-[1.25] font-semibold text-text">
          Kelime yakala
        </h2>
        <TextField
          ref={wordRef}
          label="Kelime"
          textSize="large"
          placeholder="ör. reluctant"
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
        <p className="text-small leading-[1.35] text-muted">
          Sayfanın fotoğrafını çek, Canlı Metin ile cümleyi kopyala ve buraya yapıştır.
        </p>
        <Button type="submit" variant="neutral" className="bg-control">
          Kaydet
        </Button>
        <LiveRegion visible>{liveMessage}</LiveRegion>
      </form>
    </Panel>
  );
}
