import { api, isDemo, setDemo } from './api'
import Guide, { guideSteps } from './components/Guide'
import { useEffect, useState } from 'react'
import Segmented from './components/ui/Segmented'
import { MoneyProvider, type Currency } from './money'
import { num, setNumberFormat } from './format'
import { NUMBER_FORMATS, type NumberFormat } from '@shared/number-format'
import { LANGS, langFromLocale, setLang, tr, type Lang } from '@shared/i18n'
import { EXCHANGE_IDS, exchangeName, exName, setActiveExchange, type ExchangeId } from '@shared/exchanges'
import { AlertTriangle, ArrowLeftRight, ClipboardList, GraduationCap, KeyRound, Languages, ListOrdered, PlayCircle, ScrollText, Settings, SlidersHorizontal } from 'lucide-react'
import logoUrl from './assets/logo.png'
import PlannerPage, { type Prefill } from './pages/PlannerPage'
import OrdersPage from './pages/OrdersPage'
import SettingsPage from './pages/SettingsPage'
import KeyPage from './pages/KeyPage'
import DraftsPage from './pages/DraftsPage'
import LogPage from './pages/LogPage'

type PageId = 'planner' | 'drafts' | 'orders' | 'log' | 'key' | 'settings'

const NAV_IDS: { id: PageId; icon: typeof ListOrdered }[] = [
  { id: 'planner', icon: SlidersHorizontal },
  { id: 'drafts', icon: ClipboardList },
  { id: 'orders', icon: ListOrdered },
  { id: 'log', icon: ScrollText },
  { id: 'key', icon: KeyRound },
  { id: 'settings', icon: Settings },
]

const navLabel = (id: PageId): string => ({
  planner: tr('Planer', 'Planner'),
  drafts: tr('Entwürfe', 'Drafts'),
  orders: tr('Offene Orders', 'Open orders'),
  log: tr('Protokoll', 'Log'),
  key: tr('Schlüssel', 'API key'),
  settings: tr('Einstellungen', 'Settings'),
})[id]

/** Hinweise zum Systemstatus der aktiven Börse. „online“ zeigt nichts. */
const systemText = (st: string): string | undefined => {
  const n = exName()
  return ({
    maintenance: tr(`${n} ist gerade in Wartung. Orders können weder angelegt noch storniert werden.`, `${n} is under maintenance. Orders can neither be placed nor cancelled.`),
    cancel_only: tr(`${n} erlaubt gerade nur Stornieren. Neue Orders werden abgelehnt.`, `${n} currently only allows cancelling. New orders will be rejected.`),
    reduce_only: tr(`${n} erlaubt gerade nur eingeschränkten Handel. Neue Orders können abgelehnt werden.`, `${n} currently only allows restricted trading. New orders may be rejected.`),
    post_only: tr(`${n} nimmt gerade nur Limit-Orders ins Orderbuch an (Post-only).`, `${n} currently only accepts limit orders into the order book (post-only).`),
    unreachable: tr(`${n} ist gerade nicht erreichbar. Prüfe deine Internetverbindung.`, `${n} cannot be reached right now. Check your internet connection.`),
  } as Record<string, string>)[st]
}

const GUIDE_SEEN = 'fehu-orders-guide-seen'
const LANG_KEY = 'fehu-orders-lang'

/** Sprache beim Start: zuletzt gewählt, sonst die Systemsprache */
function startLang(): Lang {
  try {
    const l = localStorage.getItem(LANG_KEY)
    if (l === 'de' || l === 'en') return l
  } catch { /* egal */ }
  return langFromLocale(navigator.language)
}

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('planner')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [currency, setCurrencyState] = useState<Currency>('EUR')
  const [rate, setRate] = useState<number | null>(null)
  const [lng, setLngState] = useState<Lang>(startLang)
  const [numFmt, setNumFmtState] = useState<NumberFormat>(() => (startLang() === 'en' ? 'en' : 'de'))
  // Modul-Werte vor dem Zeichnen setzen, damit alle Seiten im selben Durchlauf Sprache und Format nutzen
  setLang(lng)
  setNumberFormat(numFmt)
  const [exchange, setExchangeState] = useState<ExchangeId>('kraken')
  const [keys, setKeys] = useState<Partial<Record<ExchangeId, boolean>>>({})
  // Auch die Börse als Modulwert, damit Texte wie „An Kraken senden“ den richtigen Namen zeigen
  setActiveExchange(exchange)
  const [demo, setDemoState] = useState(isDemo())
  // Beim allerersten Start öffnet sich die Einführung von selbst
  const [guideStep, setGuideStep] = useState<number | null>(() => {
    try { return localStorage.getItem(GUIDE_SEEN) ? null : 0 } catch { return null }
  })

  useEffect(() => {
    api().settings().then((s) => {
      setCurrencyState(s.currency ?? 'EUR')
      setNumFmtState(s.numberFormat === 'en' ? 'en' : 'de')
      if (s.exchange) setExchangeState(s.exchange)
    })
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

  /** Andere Börse wählen: Paare, Guthaben, Pläne und Entwürfe gehören jeweils zu einer Börse */
  const switchExchange = (ex: ExchangeId) => {
    if (ex === exchange) return
    setExchangeState(ex)
    setPrefill(null)
    setHasKey(null)
    api().saveSettings({ exchange: ex }).then(refreshKey).catch(refreshKey)
  }

  // Wechselkurs nur laden, solange Dollar gewählt ist, und jede Minute auffrischen
  useEffect(() => {
    if (currency !== 'USD') return
    const load = () => api().usdRate().then(setRate).catch(() => setRate(null))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [currency, demo])

  // Sprache gilt für die echte App und die Demo gleichermaßen, deshalb immer im echten Speicher
  useEffect(() => {
    window.api?.settings().then((s) => {
      if (s.language === 'de' || s.language === 'en') {
        setLngState(s.language)
        try { localStorage.setItem(LANG_KEY, s.language) } catch { /* egal */ }
      }
    }).catch(() => undefined)
  }, [])

  /** Mit der Sprache wechselt auch das Zahlenformat (lässt sich danach getrennt zurückstellen) */
  const switchLang = (l: Lang) => {
    setLngState(l)
    try { localStorage.setItem(LANG_KEY, l) } catch { /* egal */ }
    window.api?.saveSettings({ language: l, numberFormat: l }).catch(() => undefined)
    setNumFmtState(l)
    if (isDemo()) api().saveSettings({ numberFormat: l })
  }

  const setNumFmt = (f: NumberFormat) => {
    setNumFmtState(f)
    api().saveSettings({ numberFormat: f })
  }

  const setCurrency = (c: Currency) => {
    setCurrencyState(c)
    api().saveSettings({ currency: c })
  }

  // Krakens Systemstatus alle 2 Minuten (Wartung, nur Stornieren …)
  const [system, setSystem] = useState<string>('online')
  useEffect(() => {
    const load = () => api().systemStatus().then(setSystem).catch(() => setSystem('unreachable'))
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [demo, exchange])

  // Klick auf einen Kursalarm öffnet die Entwürfe
  useEffect(() => api().onOpenPage((p) => {
    if (NAV_IDS.some((n) => n.id === p)) setPage(p as PageId)
  }), [demo])

  const refreshKey = () => api().keyStatus().then((s) => {
    setHasKey(s.hasKey)
    setKeys(s.keys ?? {})
  })
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
          {NAV_IDS.map(({ id, icon: Icon }) => {
            const on = page === id
            const label = navLabel(id)
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
            <GraduationCap size={16} /> {tr('Einführung', 'Introduction')}
          </button>
          <button type="button" onClick={() => switchDemo(!demo)} aria-pressed={demo} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${demo ? 'bg-warning-soft font-medium text-warning-fg' : 'text-ink-muted hover:bg-sunken-soft hover:text-ink'}`}>
            <PlayCircle size={16} /> {demo ? tr('Demo beenden', 'End demo') : tr('Demo-Modus', 'Demo mode')}
          </button>
        </div>
        <div className="space-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted" style={noDrag}>
          <div className="space-y-1">
            <span className="flex items-center gap-1.5" title={tr('Mit welcher Börse die App gerade arbeitet. Schlüssel, Pläne und Entwürfe gelten je Börse.', 'Which exchange the app is working with. Keys, plans and drafts belong to one exchange each.')}>
              <ArrowLeftRight size={13} /> {tr('Börse', 'Exchange')}
            </span>
            <Segmented<ExchangeId> block className="[&>.segmented-item]:min-w-0 [&>.segmented-item]:px-1" value={exchange} onChange={switchExchange} aria-label={tr('Börse', 'Exchange')}
              options={EXCHANGE_IDS.map((id) => ({ id, label: exchangeName(id), title: keys[id] ? tr(`${exchangeName(id)}: Schlüssel hinterlegt`, `${exchangeName(id)}: key saved`) : tr(`${exchangeName(id)}: noch kein Schlüssel`, `${exchangeName(id)}: no key yet`) }))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><Languages size={13} /> {tr('Sprache', 'Language')}</span>
            <Segmented<Lang> value={lng} onChange={switchLang} aria-label={tr('Sprache', 'Language')}
              options={LANGS.map((l) => ({ id: l.id, label: l.short, title: l.label }))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{tr('Anzeige', 'Display')}</span>
            <Segmented<Currency> value={currency} onChange={setCurrency} aria-label={tr('Anzeigewährung', 'Display currency')} options={[{ id: 'EUR', label: '€ EUR' }, { id: 'USD', label: '$ USD' }]} />
          </div>
          {currency === 'USD' && <p>{rate ? `1 € = ${num(rate, 4)} $ · ${tr('Orders laufen in Euro', 'orders run in euro')}` : tr('Kurs EUR/USD wird geladen …', 'Loading EUR/USD rate …')}</p>}
          <div className="space-y-1">
            <span className="flex items-center justify-between gap-2" title={tr('So schreibst du Zahlen in die Felder, und so zeigt die App sie an', 'How you type numbers into fields and how the app shows them')}>
              <span>{tr('Zahlenformat', 'Number format')}</span><span className="tabular-nums">{numFmt === 'de' ? '1.234,56' : '1,234.56'}</span>
            </span>
            <Segmented<NumberFormat> block value={numFmt} onChange={setNumFmt} aria-label={tr('Zahlenformat', 'Number format')}
              options={NUMBER_FORMATS().map((f) => ({ id: f.id, label: f.label, title: `${f.label}: ${f.example}` }))} />
          </div>
          <span className="flex items-center gap-2">
            {demo ? <><PlayCircle size={14} className="text-warning-fg" /> {tr(`Demo: nichts geht an ${exName()}`, `Demo: nothing goes to ${exName()}`)}</> : <>
            <KeyRound size={14} className={hasKey ? 'text-success-fg' : 'text-warning-fg'} />
            {hasKey === null ? '…' : hasKey ? tr(`${exName()} verbunden`, `${exName()} connected`) : tr('Kein API-Schlüssel', 'No API key')}</>}
          </span>
        </div>
      </aside>
      <main className="relative flex-1 overflow-y-auto">
        <div className="h-8 w-full" style={drag} />
        {systemText(system) && (
          <div className="page !pb-0">
            <p className={`notice ${system === 'unreachable' ? 'notice-warning' : 'notice-danger'} flex items-start gap-2`}>
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /><span>{systemText(system)}</span>
            </p>
          </div>
        )}
        {demo && (
          <div className="page !pb-0">
            <p className="notice notice-warning flex flex-wrap items-center gap-x-3 gap-y-1">
              <PlayCircle size={16} className="flex-shrink-0" />
              <span className="flex-1">{tr(<><strong>Demo-Modus.</strong> Beispielkurse und erfundenes Guthaben. Es wird nichts an {exName()} gesendet, probier ruhig alles aus.</>, <><strong>Demo mode.</strong> Sample prices and made-up balances. Nothing is sent to {exName()}, so feel free to try everything.</>)}</span>
              <button type="button" className="btn-link" onClick={() => switchDemo(false)}>{tr('Demo beenden', 'End demo')}</button>
            </p>
          </div>
        )}
        <div key={`${demo ? 'demo' : 'live'}-${exchange}`} className="contents">
        {/* Der Planer bleibt beim Reiterwechsel erhalten (nur versteckt), damit keine Eingaben verloren gehen */}
        <div className={page === 'planner' ? 'contents' : 'hidden'}><PlannerPage hasKey={!!hasKey} active={page === 'planner'} onOpenSettings={() => setPage('settings')} onNeedKey={() => setPage('key')} prefill={prefill} onPrefillUsed={() => setPrefill(null)} onOpenDrafts={() => setPage('drafts')} onOpenOrders={() => setPage('orders')} /></div>
        {page === 'drafts' && <DraftsPage hasKey={!!hasKey} onNeedKey={() => setPage('key')}
          onEdit={(d) => { setPrefill({ pairId: d.pairId, input: d.input, postOnly: d.postOnly, sendCount: d.sendCount, draft: d }); setPage('planner') }} />}
        {page === 'orders' && <OrdersPage hasKey={!!hasKey} onPlanSell={(p) => { setPrefill(p); setPage('planner') }} />}
        {page === 'log' && <LogPage />}
        {page === 'key' && <KeyPage hasKey={!!hasKey} onKeyChanged={refreshKey} />}
        {page === 'settings' && <SettingsPage hasKey={!!hasKey} onOpenKey={() => setPage('key')} />}
        </div>
      </main>
      {guideStep !== null && (
        <Guide step={Math.min(guideStep, guideSteps().length - 1)} onStep={setGuideStep} onClose={closeGuide} onPage={setPage}
          demo={demo} onStartDemo={() => { switchDemo(true); closeGuide() }} />
      )}
    </div>
    </MoneyProvider>
  )
}
