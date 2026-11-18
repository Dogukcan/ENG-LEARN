import type { TabId } from './icons.tsx'

export interface TabDefinition {
  id: TabId
  label: string
}

export const TABS: readonly TabDefinition[] = [
  { id: 'bugun', label: 'Bugün' },
  { id: 'okuma', label: 'Okuma' },
  { id: 'kelime', label: 'Kelime' },
  { id: 'dinleme', label: 'Dinleme' },
  { id: 'konusma', label: 'Konuşma' },
] as const

/** Screens reachable by the URL hash. İstatistik is a route, not a tab: it has no tab bar button. */
export type RouteId = TabId | 'istatistik'

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id))

/**
 * Parse a hash such as "#/istatistik" or "#okuma" into a route. Empty or unknown hashes fall
 * back to "bugun" so a mistyped URL never shows a blank screen.
 */
export function parseRoute(hash: string): RouteId {
  const cleaned = hash.replace(/^#\/?/, '').trim().toLowerCase()
  if (cleaned === 'istatistik') return 'istatistik'
  return TAB_IDS.has(cleaned) ? (cleaned as TabId) : 'bugun'
}

/** The tab that looks active for a route: İstatistik is opened from Bugün, so Bugün stays active. */
export function tabForRoute(route: RouteId): TabId {
  return route === 'istatistik' ? 'bugun' : route
}
