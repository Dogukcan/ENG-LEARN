import { useState } from 'react'
import { applyPwaUpdate, usePwaUpdateAvailable } from './registerSW.ts'

/*
 * Quiet "new version" notice, fixed right above the tab bar (56px bar + the iOS safe area).
 * Why quiet: an update is never urgent, so it is a calm line with one button and a close button,
 * not a modal. Dismissing hides it only until the next page load, when the waiting worker is
 * offered again.
 */
export function PwaUpdateBanner() {
  const available = usePwaUpdateAvailable()
  const [dismissed, setDismissed] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!available || dismissed) return null

  const refresh = () => {
    setFailed(false)
    // applyPwaUpdate reloads the page on success; if it rejects we tell the user instead of staying silent.
    applyPwaUpdate().catch(() => setFailed(true))
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 mx-4 mb-2 flex items-center gap-2 rounded-card border border-control bg-surface py-1 pr-1 pl-4 text-small text-text"
    >
      <span className="flex-1 leading-[1.35]">{failed ? 'Güncelleme başlamadı. Tekrar dene.' : 'Yeni sürüm var.'}</span>
      <button
        type="button"
        onClick={refresh}
        className="min-h-11 rounded-control px-3 font-semibold text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
      >
        Yenile
      </button>
      <button
        type="button"
        aria-label="Kapat"
        onClick={() => setDismissed(true)}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round]">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
