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
