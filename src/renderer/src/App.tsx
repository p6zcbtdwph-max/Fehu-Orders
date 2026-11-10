import { useEffect, useState } from 'react'
import { KeyRound, ListOrdered, Settings, SlidersHorizontal } from 'lucide-react'
import logoUrl from './assets/logo.png'
import PlannerPage, { type Prefill } from './pages/PlannerPage'
import OrdersPage from './pages/OrdersPage'
import SettingsPage from './pages/SettingsPage'

type PageId = 'planner' | 'orders' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof ListOrdered }[] = [
  { id: 'planner', label: 'Planer', icon: SlidersHorizontal },
  { id: 'orders', label: 'Offene Orders', icon: ListOrdered },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
]

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('planner')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)

  const refreshKey = () => window.api.keyStatus().then((s) => setHasKey(s.hasKey))
  useEffect(() => {
    refreshKey()
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-line bg-surface/80" style={drag}>
        <div className="px-4 pb-3 pt-11">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0 rounded-xl bg-black shadow-sm">
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-warning-500/40" />
              <img src={logoUrl} alt="Fehu Orders" className="h-9 w-9 rounded-xl" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="eyebrow">Fehu Finance</p>
              <p className="eyebrow text-warning-fg">Orders · Beta</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3" style={noDrag}>
          {NAV.map(({ id, label, icon: Icon }) => {
            const on = page === id
            return (
              <button key={id} type="button" onClick={() => setPage(id)} aria-current={on ? 'page' : undefined}
                className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${on ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:bg-sunken-soft hover:text-ink'}`}>
                <Icon size={16} className={on ? 'text-accent-fg' : 'text-ink-muted group-hover:text-ink'} />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </nav>
        <div className="border-t border-line px-4 py-3 text-xs text-ink-muted" style={noDrag}>
          <span className="flex items-center gap-2">
            <KeyRound size={14} className={hasKey ? 'text-success-fg' : 'text-warning-fg'} />
            {hasKey === null ? '…' : hasKey ? 'Kraken verbunden' : 'Kein API-Schlüssel'}
          </span>
        </div>
      </aside>
      <main className="relative flex-1 overflow-y-auto">
        <div className="h-8 w-full" style={drag} />
        {page === 'planner' && <PlannerPage hasKey={!!hasKey} onNeedKey={() => setPage('settings')} prefill={prefill} onPrefillUsed={() => setPrefill(null)} />}
        {page === 'orders' && <OrdersPage hasKey={!!hasKey} onPlanSell={(p) => { setPrefill(p); setPage('planner') }} />}
        {page === 'settings' && <SettingsPage hasKey={!!hasKey} onKeyChanged={refreshKey} />}
      </main>
    </div>
  )
}
