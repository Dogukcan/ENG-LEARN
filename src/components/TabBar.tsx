import { TabIcon, type TabId } from './icons.tsx'

export interface TabDefinition {
  id: TabId
  label: string
  hash: `#/${TabId}`
}

export const TABS: readonly TabDefinition[] = [
  { id: 'bugun', label: 'Bugün', hash: '#/bugun' },
  { id: 'okuma', label: 'Okuma', hash: '#/okuma' },
  { id: 'kelime', label: 'Kelime', hash: '#/kelime' },
  { id: 'dinleme', label: 'Dinleme', hash: '#/dinleme' },
  { id: 'konusma', label: 'Konuşma', hash: '#/konusma' },
] as const

export interface KelimeBadgeProps {
  count: number
}

/*
 * Neutral count badge on the Kelime tab icon, matching design/drafts/today-d.html (.nav-badge).
 * Hidden when count is 0 (or negative) so an empty inbox leaves the tab bar quiet.
 */
export function KelimeBadge({ count }: KelimeBadgeProps) {
  if (count <= 0) {
    return null
  }

  return (
    <span className="num absolute -top-[4px] -right-[13px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-text px-[5px] text-[12px] leading-[18px] font-semibold text-ground">
      {count}
    </span>
  )
}

export interface TabBarProps {
  activeTab: TabId
  onSelectTab: (tab: TabId) => void
  /** Badge count for the Kelime tab; hidden at 0. */
  count?: number
}

/*
 * Native iPhone-style bottom tab bar:
 * - Fixed at the bottom of the viewport with solid --surface background and a 1px --control top hairline.
 * - Uses padding-bottom: env(safe-area-inset-bottom) so the 56px button row sits above the iOS home indicator
 *   while the solid --surface background extends all the way to the physical bottom edge.
 * - Active tab uses a filled icon + --text 600 label; inactive tabs use a 1.75px outline icon + --muted 500 label.
 * - No pill, no backdrop blur, and no transition animation for instant switching.
 */
export function TabBar({ activeTab, onSelectTab, count = 0 }: TabBarProps) {
  return (
    <nav
      aria-label="Ana menü"
      className="fixed inset-x-0 bottom-0 z-20 grid min-h-[calc(56px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-control bg-surface px-1 pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id

        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectTab(tab.id)}
            className={`relative flex h-[56px] min-h-[44px] flex-col items-center justify-center gap-[3px] bg-transparent text-[12px] leading-[1.1] ${
              isActive ? 'font-semibold text-text' : 'font-medium text-muted'
            }`}
          >
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <TabIcon tab={tab.id} filled={isActive} />
              {tab.id === 'kelime' ? <KelimeBadge count={count} /> : null}
            </span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
