interface SentenceWithWordProps {
  sentence: string;
  word: string;
}

/**
 * Shows a sentence with the captured word in weight 700.
 *
 * Why we build React nodes instead of an HTML string: the sentence is typed by the user, and
 * putting user text into HTML would open the door to script injection. React escapes text nodes
 * for us, so splitting the string and wrapping the match in <strong> is the safe way.
 */
export function SentenceWithWord({ sentence, word }: SentenceWithWordProps) {
  const target = word.trim();
  if (!target) return <>{sentence}</>;

  // Escape regex characters, because a word like "c++" must be matched literally.
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A capture group in split() keeps the matches in the result, at the odd indexes.
  const parts = sentence.split(new RegExp(`(${escaped})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-bold">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
