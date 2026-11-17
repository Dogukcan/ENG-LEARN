import type { Book, CaptureSource } from "../../data";

/**
 * Turn a stored source into the short line shown on the triage card.
 * The book short name comes from the books list, because an inbox item stores only the book id
 * (the id never changes, while a title or short name could be edited later).
 */
export function formatSource(source: CaptureSource, books: readonly Book[]): string {
  switch (source.kind) {
    case "kitap": {
      const book = books.find((b) => b.id === source.bookId);
      return book ? `Kitap · ${book.shortName} · s. ${source.page}` : `Kitap · s. ${source.page}`;
    }
    case "video":
      return source.label ? `Video · ${source.label}` : "Video";
    case "konusma":
      return "Konuşma";
    case "diger":
      return "Diğer";
  }
}

/** "harbour, harbr" -> ["harbour", "harbr"]. Blank parts are dropped; the repository normalises case. */
export function parseAlternatives(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
