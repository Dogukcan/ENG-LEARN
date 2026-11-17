import { useEffect, useState } from 'react'
import { TabBar } from './components/TabBar.tsx'
import { TABS } from './components/tabs.ts'
import type { TabId } from './components/icons.tsx'
import { BugunScreen } from './screens/BugunScreen.tsx'
import { DinlemeScreen } from './screens/DinlemeScreen.tsx'
import { KelimeScreen } from './screens/KelimeScreen.tsx'
import { KonusmaScreen } from './screens/KonusmaScreen.tsx'
import { OkumaScreen } from './screens/OkumaScreen.tsx'
import { useRepoData } from './data/react.ts'

const VALID_TAB_IDS = new Set<TabId>(TABS.map((t) => t.id))

/*
 * Parse window.location.hash (e.g. "#/okuma" or "#okuma") into a valid TabId.
 * Falls back to "bugun" when the hash is empty or unrecognized.
 */
function parseTabFromHash(hash: string): TabId {
  const cleaned = hash.replace(/^#\/?/, '').trim().toLowerCase()
  if (VALID_TAB_IDS.has(cleaned as TabId)) {
    return cleaned as TabId
  }
  return 'bugun'
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    typeof window !== 'undefined' ? parseTabFromHash(window.location.hash) : 'bugun',
  )

  // Live inbox size for the Kelime tab badge; useRepoData reloads it after every repository write.
  const { data: inboxCount } = useRepoData((repo) => repo.inbox.list().then((items) => items.length), [])

  useEffect(() => {
    // Normalize the initial URL hash with replaceState so reloading keeps the tab
    // without adding a duplicate entry to the browser history stack.
    const initialCanonicalHash = `#/${parseTabFromHash(window.location.hash)}`
    if (window.location.hash !== initialCanonicalHash) {
      window.history.replaceState(null, '', initialCanonicalHash)
    }

    // Listen to hashchange so browser Back/Forward buttons or manual hash edits
    // update React tab state and canonicalize invalid hashes via replaceState.
    const handleHashChange = () => {
      const nextTab = parseTabFromHash(window.location.hash)
      const canonicalHash = `#/${nextTab}`
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash)
      }
      setActiveTab(nextTab)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleSelectTab = (nextTab: TabId) => {
    setActiveTab(nextTab)
    const nextHash = `#/${nextTab}`
    // Assigning window.location.hash pushes a history entry so the browser Back button returns to the previous tab.
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash
    }
  }

  return (
    /*
     * Why h-dvh (100dvh) instead of h-screen (100vh):
     * On iOS Safari and mobile Chrome, 100vh measures the viewport as if the address bar were hidden,
     * which pushes bottom content under the browser chrome when the address bar is visible.
     * 100dvh (dynamic viewport height) adapts to the actual visible viewport height.
     */
    <div className="flex h-dvh min-h-dvh w-full flex-col bg-ground font-sans text-body text-text">
      {/*
       * Scrollable screen container:
       * Bottom padding reserves 56px for the fixed tab bar + 16px breathing room + env(safe-area-inset-bottom)
       * so the bottom of any screen is never obscured behind the fixed navigation bar.
       */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(56px+16px+env(safe-area-inset-bottom))]">
        {activeTab === 'bugun' && <BugunScreen />}
        {activeTab === 'okuma' && <OkumaScreen />}
        {activeTab === 'kelime' && <KelimeScreen />}
        {activeTab === 'dinleme' && <DinlemeScreen />}
        {activeTab === 'konusma' && <KonusmaScreen />}
      </main>

      <TabBar activeTab={activeTab} onSelectTab={handleSelectTab} count={inboxCount ?? 0} />
    </div>
  )
}

export default App
