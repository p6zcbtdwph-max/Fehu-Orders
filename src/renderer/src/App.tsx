import { api, isDemo, setDemo } from './api'
import Guide, { guideSteps } from './components/Guide'
import { useEffect, useState } from 'react'
import Segmented from './components/ui/Segmented'
import { MoneyProvider, type Currency } from './money'
import { num, setNumberFormat } from './format'
import { NUMBER_FORMATS, type NumberFormat } from '@shared/number-format'
import { LANGS, langFromLocale, setLang, tr, type Lang } from '@shared/i18n'
import { exName, setActiveExchange, type ExchangeId } from '@shared/exchanges'
import { AlertTriangle, ClipboardList, GraduationCap, History, LayoutDashboard, ListOrdered, PieChart, PlayCircle, Settings, SlidersHorizontal } from 'lucide-react'
import logoUrl from './assets/logo.png'
import PlannerPage, { type Prefill, type SideStart } from './pages/PlannerPage'
import PlansPage, { type PlansView, type PlanFilter } from './pages/PlansPage'
import OverviewPage, { DEMO_TRIED } from './pages/OverviewPage'
import { usePlanData } from './plan-data'
import SettingsPage, { type SettingsSection } from './pages/SettingsPage'
import SectionCard from './components/ui/SectionCard'
import TopBar from './components/TopBar'
import KeyPage from './pages/KeyPage'
import LogPage from './pages/LogPage'
import PortfolioPage from './pages/PortfolioPage'

type PageId = 'overview' | 'planner' | 'plans' | 'portfolio' | 'log' | 'settings'
/**
 * Seiten, die man von außen ansteuern kann. Seit der neuen Navigation sind „key“ ein Teil der Einstellungen
 * und „drafts“/„orders“ Filter von „Meine Pläne“ (Kursalarm aus dem Hauptprozess, Einführung).
 */
type PageTarget = PageId | 'key' | 'drafts' | 'orders'

/** Die Arbeitsbereiche oben in der Seitenleiste, in der Reihenfolge, in der man arbeitet */
const NAV_IDS: { id: PageId; icon: typeof ListOrdered }[] = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'planner', icon: SlidersHorizontal },
  { id: 'plans', icon: ClipboardList },
  { id: 'portfolio', icon: PieChart },
  { id: 'log', icon: History },
]

const navLabel = (id: PageId): string => ({
  overview: tr('Übersicht', 'Overview'),
  planner: tr('Neuer Plan', 'New plan'),
  plans: tr('Meine Pläne', 'My plans'),
  portfolio: 'Portfolio',
  log: tr('Verlauf', 'History'),
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

/** Eine Zeile in der Seitenleiste */
function NavButton({ on, icon: Icon, label, onClick, tone }: { on: boolean; icon: typeof ListOrdered; label: string; onClick: () => void; tone?: 'warning' }) {
  const active = tone === 'warning' ? 'bg-warning-soft font-medium text-warning-fg' : 'bg-accent-soft font-medium text-ink'
  return (
    <button type="button" onClick={onClick} aria-current={on && !tone ? 'page' : undefined} aria-pressed={tone ? on : undefined}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${on ? active : 'text-ink-muted hover:bg-sunken-soft hover:text-ink'}`}>
      <Icon size={16} className={on ? (tone ? '' : 'text-accent-fg') : 'text-ink-muted group-hover:text-ink'} />
      <span className="truncate">{label}</span>
    </button>
  )
}

export default function App(): JSX.Element {
  const [page, setPageState] = useState<PageId>('overview')
  const [plansView, setPlansView] = useState<PlansView>({ filter: 'all', id: null })
  /** Zählt hoch, wenn „Erster Test“ im Planer geöffnet werden soll */
  const [firstTest, setFirstTest] = useState(0)
  const [section, setSection] = useState<SettingsSection>('exchanges')
  /** Zählt hoch nach der Notbremse, damit „Offene Orders“ neu lädt */
  const [reload, setReload] = useState(0)
  /** Seite öffnen. „key“ führt zu Einstellungen › Börsen und Schlüssel. */
  const setPage = (p: PageTarget) => {
    if (p === 'key') { setSection('exchanges'); setPageState('settings') }
    else if (p === 'drafts' || p === 'orders') { setPlansView({ filter: p === 'drafts' ? 'drafts' : 'running', id: null }); setPageState('plans') }
    else setPageState(p)
  }
  /** „Meine Pläne“ öffnen, optional mit Filter oder einem bestimmten Plan */
  const openPlans = (filter: PlanFilter = 'all', id: string | null = null) => {
    setPlansView({ filter, id })
    setPageState('plans')
  }
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [prefill, setPrefill] = useState<Prefill | SideStart | null>(null)
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
    setPage('overview')
    if (on) try { localStorage.setItem(DEMO_TRIED, '1') } catch { /* egal */ }
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
    if (NAV_IDS.some((n) => n.id === p) || ['settings', 'key', 'drafts', 'orders'].includes(p)) setPage(p as PageTarget)
  }), [demo])

  // Daten für „Übersicht“ und „Meine Pläne“. Neu laden beim Öffnen dieser Seiten, nach der Notbremse
  // und beim Wechsel von Börse oder Demo-Modus.
  const planView = page === 'overview' || page === 'plans' ? page : ''
  const planData = usePlanData(!!hasKey, `${reload}|${demo}|${exchange}|${planView}`)

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
        <nav className="flex-1 space-y-0.5 px-3" style={noDrag} aria-label={tr('Bereiche', 'Sections')}>
          {NAV_IDS.map(({ id, icon }) => <NavButton key={id} on={page === id} icon={icon} label={navLabel(id)} onClick={() => setPage(id)} />)}
        </nav>
        <div className="space-y-0.5 border-t border-line px-3 py-2" style={noDrag}>
          <NavButton on={page === 'settings'} icon={Settings} label={navLabel('settings')} onClick={() => setPage('settings')} />
          <NavButton on={false} icon={GraduationCap} label={tr('Einführung', 'Introduction')} onClick={() => setGuideStep(0)} />
          <NavButton on={demo} tone="warning" icon={PlayCircle} label={demo ? tr('Demo beenden', 'End demo') : tr('Demo-Modus', 'Demo mode')} onClick={() => switchDemo(!demo)} />
        </div>
      </aside>
      <main className="relative flex-1 overflow-y-auto">
        <TopBar exchange={exchange} keys={keys} hasKey={hasKey} demo={demo} onExchange={switchExchange}
          onManageKeys={() => setPage('key')} onEndDemo={() => switchDemo(false)} onEmergencyDone={() => setReload((n) => n + 1)} />
        {systemText(system) && (
          <div className="page !pb-0">
            <p className={`notice ${system === 'unreachable' ? 'notice-warning' : 'notice-danger'} flex items-start gap-2`}>
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /><span>{systemText(system)}</span>
            </p>
          </div>
        )}
        <div key={`${demo ? 'demo' : 'live'}-${exchange}`} className="contents">
        {/* Der Planer bleibt beim Reiterwechsel erhalten (nur versteckt), damit keine Eingaben verloren gehen */}
        {page === 'overview' && <OverviewPage hasKey={!!hasKey} demo={demo} data={planData}
          onOpenPlan={(id) => openPlans('all', id)} onOpenPlans={() => openPlans('running')}
          onNewPlan={(side) => { setPrefill({ side }); setPage('planner') }} onGuide={() => setGuideStep(0)} onDemo={() => switchDemo(true)}
          onNeedKey={() => setPage('key')} onFirstTest={() => { setPage('planner'); setFirstTest((n) => n + 1) }} />}
        <div className={page === 'planner' ? 'contents' : 'hidden'}><PlannerPage hasKey={!!hasKey} active={page === 'planner'} onOpenSettings={() => { setSection('safety'); setPage('settings') }} onNeedKey={() => setPage('key')} prefill={prefill} onPrefillUsed={() => setPrefill(null)} onOpenDrafts={() => openPlans('drafts')} onOpenOrders={() => openPlans('running')} firstTest={firstTest} /></div>
        {page === 'plans' && <PlansPage hasKey={!!hasKey} data={planData} view={plansView} onView={setPlansView} onNeedKey={() => setPage('key')}
          onEditDraft={(d) => { setPrefill({ pairId: d.pairId, input: d.input, postOnly: d.postOnly, sendCount: d.sendCount, draft: d }); setPage('planner') }}
          onPlanSell={(p) => { setPrefill(p); setPage('planner') }} />}
        {page === 'portfolio' && <PortfolioPage reload={`${reload}|${demo}|${exchange}`} onOpenPlan={(id) => openPlans('all', id)} />}
        {page === 'log' && <LogPage />}
        {page === 'settings' && <SettingsPage section={section} onSection={setSection}
          keys={<KeyPage active={exchange} keys={keys} onKeyChanged={refreshKey} onUse={switchExchange} />}
          display={<SectionCard title={tr('Anzeige', 'Display')}>
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{tr('Sprache', 'Language')}</span><span className="block text-xs text-ink-muted">{tr('Das Zahlenformat wechselt mit, lässt sich danach aber getrennt einstellen.', 'The number format switches along, but can be set separately afterwards.')}</span></span>
                <Segmented<Lang> value={lng} onChange={switchLang} aria-label={tr('Sprache', 'Language')}
                  options={LANGS.map((l) => ({ id: l.id, label: l.label, title: l.label }))} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{tr('Anzeigewährung', 'Display currency')}</span><span className="block text-xs text-ink-muted">{currency === 'USD' ? (rate ? `1 € = ${num(rate, 4)} $ · ${tr('Orders laufen weiter in Euro', 'orders still run in euro')}` : tr('Kurs EUR/USD wird geladen …', 'Loading EUR/USD rate …')) : tr('Beträge in Euro. Mit Dollar rechnet die App nur zur Anzeige um.', 'Amounts in euro. With dollar the app only converts for display.')}</span></span>
                <Segmented<Currency> value={currency} onChange={setCurrency} aria-label={tr('Anzeigewährung', 'Display currency')} options={[{ id: 'EUR', label: '€ EUR' }, { id: 'USD', label: '$ USD' }]} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{tr('Zahlenformat', 'Number format')}</span><span className="block text-xs text-ink-muted">{tr('So schreibst du Zahlen in die Felder, und so zeigt die App sie an', 'How you type numbers into fields and how the app shows them')}: <span className="tabular-nums">{numFmt === 'de' ? '1.234,56' : '1,234.56'}</span></span></span>
                <Segmented<NumberFormat> value={numFmt} onChange={setNumFmt} aria-label={tr('Zahlenformat', 'Number format')}
                  options={NUMBER_FORMATS().map((f) => ({ id: f.id, label: f.label, title: `${f.label}: ${f.example}` }))} />
              </div>
            </div>
          </SectionCard>} />}
        </div>
      </main>
      {guideStep !== null && (
        <Guide step={Math.min(guideStep, guideSteps().length - 1)} onStep={setGuideStep} onClose={closeGuide} onPage={(p) => { if (p === 'settings') setSection('safety'); setPage(p) }}
          demo={demo} onStartDemo={() => { switchDemo(true); closeGuide() }} />
      )}
    </div>
    </MoneyProvider>
  )
}
