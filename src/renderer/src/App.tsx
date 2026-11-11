import { api, isDemo, setDemo } from './api'
import Guide, { GUIDE_STEPS } from './components/Guide'
import { useEffect, useState } from 'react'
import Segmented from './components/ui/Segmented'
import { MoneyProvider, type Currency } from './money'
import { ClipboardList, GraduationCap, KeyRound, ListOrdered, PlayCircle, Settings, SlidersHorizontal } from 'lucide-react'
import logoUrl from './assets/logo.png'
import PlannerPage, { type Prefill } from './pages/PlannerPage'
import OrdersPage from './pages/OrdersPage'
import SettingsPage from './pages/SettingsPage'
import KeyPage from './pages/KeyPage'
import DraftsPage from './pages/DraftsPage'

type PageId = 'planner' | 'drafts' | 'orders' | 'key' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof ListOrdered }[] = [
  { id: 'planner', label: 'Planer', icon: SlidersHorizontal },
  { id: 'drafts', label: 'Entwürfe', icon: ClipboardList },
  { id: 'orders', label: 'Offene Orders', icon: ListOrdered },
  { id: 'key', label: 'Schlüssel', icon: KeyRound },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
]

const GUIDE_SEEN = 'fehu-orders-guide-seen'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('planner')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [currency, setCurrencyState] = useState<Currency>('EUR')
  const [rate, setRate] = useState<number | null>(null)
  const [demo, setDemoState] = useState(isDemo())
  // Beim allerersten Start öffnet sich die Einführung von selbst
  const [guideStep, setGuideStep] = useState<number | null>(() => {
    try { return localStorage.getItem(GUIDE_SEEN) ? null : 0 } catch { return null }
  })

  useEffect(() => {
    api().settings().then((s) => setCurrencyState(s.currency ?? 'EUR'))
  }, [demo])

  const closeGuide = () => {
    setGuideStep(null)
    try { localStorage.setItem(GUIDE_SEEN, '1') } catch { /* egal */ }
  }

  const switchDemo = (on: boolean) => {
    setDemo(on)
    setDemoState(on)
    setPrefill(null)
    setPage('planner')
    api().keyStatus().then((s) => setHasKey(s.hasKey))
  }

  // Wechselkurs nur laden, solange Dollar gewählt ist, und jede Minute auffrischen
  useEffect(() => {
    if (currency !== 'USD') return
    const load = () => api().usdRate().then(setRate).catch(() => setRate(null))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [currency, demo])

  const setCurrency = (c: Currency) => {
    setCurrencyState(c)
    api().saveSettings({ currency: c })
  }

  const refreshKey = () => api().keyStatus().then((s) => setHasKey(s.hasKey))
  useEffect(() => {
    refreshKey()
  }, [])

  return (
    <MoneyProvider value={{ currency, rate, setCurrency }}>
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
        <div className="space-y-0.5 px-3 pb-2" style={noDrag}>
          <button type="button" onClick={() => setGuideStep(0)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-muted transition-colors hover:bg-sunken-soft hover:text-ink">
            <GraduationCap size={16} /> Einführung
          </button>
          <button type="button" onClick={() => switchDemo(!demo)} aria-pressed={demo} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${demo ? 'bg-warning-soft font-medium text-warning-fg' : 'text-ink-muted hover:bg-sunken-soft hover:text-ink'}`}>
            <PlayCircle size={16} /> {demo ? 'Demo beenden' : 'Demo-Modus'}
          </button>
        </div>
        <div className="space-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted" style={noDrag}>
          <div className="flex items-center justify-between gap-2">
            <span>Anzeige</span>
            <Segmented<Currency> value={currency} onChange={setCurrency} aria-label="Anzeigewährung" options={[{ id: 'EUR', label: '€ EUR' }, { id: 'USD', label: '$ USD' }]} />
          </div>
          {currency === 'USD' && <p>{rate ? `1 € = ${rate.toFixed(4).replace('.', ',')} $ · Orders laufen in Euro` : 'Kurs EUR/USD wird geladen …'}</p>}
          <span className="flex items-center gap-2">
            {demo ? <><PlayCircle size={14} className="text-warning-fg" /> Demo: nichts geht an Kraken</> : <>
            <KeyRound size={14} className={hasKey ? 'text-success-fg' : 'text-warning-fg'} />
            {hasKey === null ? '…' : hasKey ? 'Kraken verbunden' : 'Kein API-Schlüssel'}</>}
          </span>
        </div>
      </aside>
      <main className="relative flex-1 overflow-y-auto">
        <div className="h-8 w-full" style={drag} />
        {demo && (
          <div className="page !pb-0">
            <p className="notice notice-warning flex flex-wrap items-center gap-x-3 gap-y-1">
              <PlayCircle size={16} className="flex-shrink-0" />
              <span className="flex-1"><strong>Demo-Modus.</strong> Beispielkurse und erfundenes Guthaben. Es wird nichts an Kraken gesendet, probier ruhig alles aus.</span>
              <button type="button" className="btn-link" onClick={() => switchDemo(false)}>Demo beenden</button>
            </p>
          </div>
        )}
        <div key={demo ? 'demo' : 'live'} className="contents">
        {page === 'planner' && <PlannerPage hasKey={!!hasKey} onNeedKey={() => setPage('key')} prefill={prefill} onPrefillUsed={() => setPrefill(null)} onOpenDrafts={() => setPage('drafts')} />}
        {page === 'drafts' && <DraftsPage hasKey={!!hasKey} onNeedKey={() => setPage('key')}
          onEdit={(d) => { setPrefill({ pairId: d.pairId, input: d.input, postOnly: d.postOnly, sendCount: d.sendCount, draft: d }); setPage('planner') }} />}
        {page === 'orders' && <OrdersPage hasKey={!!hasKey} onPlanSell={(p) => { setPrefill(p); setPage('planner') }} />}
        {page === 'key' && <KeyPage hasKey={!!hasKey} onKeyChanged={refreshKey} />}
        {page === 'settings' && <SettingsPage hasKey={!!hasKey} onOpenKey={() => setPage('key')} />}
        </div>
      </main>
      {guideStep !== null && (
        <Guide step={Math.min(guideStep, GUIDE_STEPS.length - 1)} onStep={setGuideStep} onClose={closeGuide} onPage={setPage}
          demo={demo} onStartDemo={() => { switchDemo(true); closeGuide() }} />
      )}
    </div>
    </MoneyProvider>
  )
}
