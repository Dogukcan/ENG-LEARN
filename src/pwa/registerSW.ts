import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

// Tiny external store so any component can ask "is a new version waiting?".
// A later UI can render "Yeni sürüm var. Yenile" from `usePwaUpdateAvailable` and call `applyPwaUpdate`.
let updateAvailable = false
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function setUpdateAvailable(value: boolean): void {
  if (updateAvailable === value) return
  updateAvailable = value
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Registers the service worker once. Safe to call again: later calls do nothing. */
export function registerServiceWorker(): void {
  if (applyUpdate) return
  // registerSW only does real work in a production build; in dev the virtual module is a no-op.
  applyUpdate = registerSW({
    // Called when a new service worker has installed and is waiting. Nothing is shown here on purpose.
    onNeedRefresh: () => setUpdateAvailable(true),
  })
}

/** True when a new app version is downloaded and waiting for the user to reload. */
export function usePwaUpdateAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => updateAvailable,
    () => false,
  )
}

/** Activates the waiting service worker and reloads the page. Call it from the "Yenile" button. */
export async function applyPwaUpdate(): Promise<void> {
  if (!applyUpdate) return
  await applyUpdate(true)
}
