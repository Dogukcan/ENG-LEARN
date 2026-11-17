export type TabId = 'bugun' | 'okuma' | 'kelime' | 'dinleme' | 'konusma'

export interface TabIconProps {
  filled: boolean
}

/*
 * Inline SVG icons copied verbatim from design/drafts/today-d.html.
 *
 * Why each tab has a paired outline (1.75px stroke) and filled SVG instead of a pill background:
 * Native iPhone tab bars distinguish the active destination by switching from a 1.75px stroke
 * outline in --muted to a solid filled silhouette in --text, keeping the bar calm without
 * floating pills, blurs, or color-fill boxes.
 */

const outlineProps = {
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
  className: 'block h-6 w-6 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]',
}

const filledProps = {
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
  className: 'block h-6 w-6 fill-current stroke-none',
}

export function BugunIcon({ filled }: TabIconProps) {
  if (filled) {
    return (
      <svg {...filledProps}>
        <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v2H2V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm15 9H2v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8z" />
      </svg>
    )
  }
  return (
    <svg {...outlineProps}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  )
}

export function OkumaIcon({ filled }: TabIconProps) {
  if (filled) {
    return (
      <svg {...filledProps}>
        <path d="M2 3h7a4.5 4.5 0 0 1 2.25.6V20.5a2.5 2.5 0 0 0-2.25-1.5H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm20 0h-7a4.5 4.5 0 0 0-2.25.6V20.5a2.5 2.5 0 0 1 2.25-1.5h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" />
      </svg>
    )
  }
  return (
    <svg {...outlineProps}>
      <path d="M2 4h7a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-7a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h8z" />
    </svg>
  )
}

export function KelimeIcon({ filled }: TabIconProps) {
  if (filled) {
    return (
      <svg {...filledProps}>
        <path d="M7 2a1 1 0 0 0 0 2h12a1 1 0 0 1 1 1v11a1 1 0 1 0 2 0V5a3 3 0 0 0-3-3H7z" />
        <rect x="2" y="5" width="16" height="15" rx="3" />
      </svg>
    )
  }
  return (
    <svg {...outlineProps}>
      <rect x="3" y="6" width="15" height="13" rx="2" />
      <path d="M7 3h13a2 2 0 0 1 2 2v11" />
    </svg>
  )
}

export function DinlemeIcon({ filled }: TabIconProps) {
  if (filled) {
    return (
      <svg {...filledProps}>
        <path d="M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h2a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z" />
      </svg>
    )
  }
  return (
    <svg {...outlineProps}>
      <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
      <rect x="2" y="13" width="4" height="6" rx="1" />
      <rect x="18" y="13" width="4" height="6" rx="1" />
    </svg>
  )
}

export function KonusmaIcon({ filled }: TabIconProps) {
  if (filled) {
    return (
      <svg {...filledProps}>
        <path d="M12 3a9 9 0 0 0-8 13.12V21a1 1 0 0 0 1.6.8L9.33 19H13a9 9 0 0 0 0-18h-1z" />
      </svg>
    )
  }
  return (
    <svg {...outlineProps}>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12z" />
    </svg>
  )
}

export function TabIcon({ tab, filled }: { tab: TabId; filled: boolean }) {
  switch (tab) {
    case 'bugun':
      return <BugunIcon filled={filled} />
    case 'okuma':
      return <OkumaIcon filled={filled} />
    case 'kelime':
      return <KelimeIcon filled={filled} />
    case 'dinleme':
      return <DinlemeIcon filled={filled} />
    case 'konusma':
      return <KonusmaIcon filled={filled} />
  }
}
