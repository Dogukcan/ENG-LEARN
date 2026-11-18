import { useEffect, useState } from 'react'
import { TabBar } from './components/TabBar.tsx'
import { parseRoute, tabForRoute } from './components/tabs.ts'
import type { RouteId } from './components/tabs.ts'
import type { TabId } from './components/icons.tsx'
import { BugunScreen } from './screens/BugunScreen.tsx'
import { DinlemeScreen } from './screens/DinlemeScreen.tsx'
import { KelimeScreen } from './screens/KelimeScreen.tsx'
import { IstatistikScreen } from './screens/IstatistikScreen.tsx'
import { KonusmaScreen } from './screens/KonusmaScreen.tsx'
import { OkumaScreen } from './screens/OkumaScreen.tsx'
import { useRepoData } from './data/react.ts'
import { TimerProvider } from './features/timer/TimerProvider.tsx'
import { PwaUpdateBanner } from './pwa/PwaUpdateBanner.tsx'

function AppShell() {
  // The route is what the hash says; the tab bar highlight is derived from it (İstatistik keeps Bugün lit).
  const [route, setRoute] = useState<RouteId>(() =>
    typeof window !== 'undefined' ? parseRoute(window.location.hash) : 'bugun',
  )
  const activeTab = tabForRoute(route)

  // Live inbox size for the Kelime tab badge; useRepoData reloads it after every repository write.
  const { data: inboxCount } = useRepoData((repo) => repo.inbox.list().then((items) => items.length), [])

  useEffect(() => {
    // Normalize the initial URL hash with replaceState so reloading keeps the tab
    // without adding a duplicate entry to the browser history stack.
    const initialCanonicalHash = `#/${parseRoute(window.location.hash)}`
    if (window.location.hash !== initialCanonicalHash) {
      window.history.replaceState(null, '', initialCanonicalHash)
    }

    // Listen to hashchange so browser Back/Forward buttons or manual hash edits
    // update React tab state and canonicalize invalid hashes via replaceState.
    const handleHashChange = () => {
      const nextRoute = parseRoute(window.location.hash)
      const canonicalHash = `#/${nextRoute}`
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash)
      }
      setRoute(nextRoute)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleSelectTab = (nextTab: TabId) => {
    setRoute(nextTab)
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
        {route === 'bugun' && <BugunScreen />}
        {route === 'istatistik' && <IstatistikScreen />}
        {activeTab === 'okuma' && <OkumaScreen />}
        {activeTab === 'kelime' && <KelimeScreen />}
        {activeTab === 'dinleme' && <DinlemeScreen />}
        {activeTab === 'konusma' && <KonusmaScreen />}
      </main>

      <PwaUpdateBanner />
      <TabBar activeTab={activeTab} onSelectTab={handleSelectTab} count={inboxCount ?? 0} />
    </div>
  )
}

// One timer for the whole app: every screen reads it with useTimer(), and a running timer keeps
// counting while the user switches tabs. The provider wraps the shell so all screens share it.
export function App() {
  return (
    <TimerProvider>
      <AppShell />
    </TimerProvider>
  )
}

export default App
