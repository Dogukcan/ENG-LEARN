import { Button } from "./Button.tsx";

/**
 * Shown when a screen could not read its data. Why a retry button: a failed IndexedDB read (for example
 * after iOS dropped the connection in the background) is fixed by reading again, and without a message
 * the user would think their data was deleted.
 */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="text-body leading-[1.4] text-muted">Veriler yüklenemedi. Verilerin bu cihazda duruyor.</p>
      <Button onClick={onRetry}>Tekrar dene</Button>
    </div>
  );
}
