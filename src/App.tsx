import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LockRow } from './db'
import type { Tx } from './domain/types'
import { monthOf, todayISO } from './domain/money'
import { getLock, isLockEnabled } from './lock'
import { Accounts, type EntryPreset } from './ui/Accounts'
import { Analytics } from './ui/Analytics'
import { Budget } from './ui/Budget'
import { Calendar } from './ui/Calendar'
import { Categories } from './ui/Categories'
import { Plan } from './ui/Plan'
import { Sheet, useAmountsHidden } from './ui/common'
import { useData } from './ui/data'
import { Distribute } from './ui/Distribute'
import { Entry } from './ui/Entry'
import { History, type OpsFilter } from './ui/History'
import { Home } from './ui/Home'
import { Icon, type IconName } from './ui/icons'
import { LockScreen } from './ui/Lock'
import { More, type MorePage, type MoreSection } from './ui/More'
import { notify, runUndo, useNotice } from './ui/undo'
import { Pushed, TopBar } from './ui/nav'

type Tab = 'home' | 'history' | 'budget' | 'more'
const TABS: { id: Tab | 'add'; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'history', label: 'Операции', icon: 'list' },
  { id: 'add', label: '', icon: 'plus' },
  { id: 'budget', label: 'Бюджет', icon: 'pie' },
  { id: 'more', label: 'Ещё', icon: 'more' },
]
const RELOCK_AFTER_MS = 60_000

const TAB_TITLE: Record<Tab, string> = { home: 'Главная', history: 'Операции', budget: 'Бюджет', more: 'Ещё' }
const PAGE_TITLE: Record<MorePage, string> = { calendar: 'Календарь', analytics: 'Аналитика', accounts: 'Счета и цели', goals: 'Счета и цели', invest: 'Инвестиции', categories: 'Категории', plan: 'План платежей' }

export default function App() {
  const data = useData()
  const [tab, setTab] = useState<Tab>('home')
  // Подраздел, открытый поверх раздела: у каждой вкладки свой (как стек навигации в iOS).
  const [pushed, setPushed] = useState<Record<Tab, MorePage | null>>({ home: null, history: null, budget: null, more: null })
  const [closing, setClosing] = useState(0)
  const [section, setSection] = useState<MoreSection | null>(null)
  const [adding, setAdding] = useState<EntryPreset | null>(null)
  const hidden = useAmountsHidden()
  const [lock, setLock] = useState<LockRow | null>(null)
  const [locked, setLocked] = useState(true)
  const [opsFilter, setOpsFilter] = useState<OpsFilter>(() => { const m = monthOf(todayISO()); return { from: m, to: m } })
  const notice = useNotice()
  const [distribute, setDistribute] = useState<Tx | null>(null)
  const hiddenAt = useRef<number | null>(null)
  // Каждая вкладка помнит свою прокрутку.
  const scrollOf = useRef<Record<Tab, number>>({ home: 0, history: 0, budget: 0, more: 0 })
  const roots = { home: useRef<HTMLDivElement>(null), history: useRef<HTMLDivElement>(null), budget: useRef<HTMLDivElement>(null), more: useRef<HTMLDivElement>(null) }

  useEffect(() => {
    getLock().then(l => { setLock(l); setLocked(isLockEnabled(l)) })
    const onVis = async () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return }
      if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
        const l = await getLock()
        setLock(l)
        if (isLockEnabled(l)) setLocked(true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useLayoutEffect(() => { window.scrollTo(0, scrollOf.current[tab]) }, [tab])

  if (!lock || !data) return null
  if (locked && isLockEnabled(lock)) return <LockScreen lock={lock} onUnlock={() => setLocked(false)} />

  function onSaved(tx: Tx) {
    setAdding(null)
    if (tx.type === 'income') setDistribute(tx)
    notify('Сохранено')
  }
  const switchTo = (t: Tab) => { if (t !== tab) { scrollOf.current[tab] = window.scrollY; setTab(t) } }
  /** Подраздел открывается в текущей вкладке: «Назад» ведёт туда, откуда пришли. */
  const openPage = (p: MorePage) => setPushed(s => ({ ...s, [tab]: p }))
  const openSection = (sec: MoreSection) => { switchTo('more'); setSection(sec) }
  const openOps = (f: OpsFilter) => { setOpsFilter(f); switchTo('history') }
  const goTab = (t: Tab) => {
    if (t !== tab) return switchTo(t)
    // Повторное касание: закрыть подраздел, иначе — плавно наверх.
    if (pushed[t]) setClosing(c => c + 1)
    else window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const page = (p: MorePage) => (
    p === 'calendar' ? <Calendar data={data} />
      : p === 'analytics' ? <Analytics data={data} onOpenOps={openOps} />
      : p === 'categories' ? <Categories data={data} />
      : p === 'plan' ? <Plan data={data} />
      : <Accounts key={p} data={data} onOpenOps={openOps} onAdd={setAdding} initialTab={p === 'goals' ? 'goals' : p === 'invest' ? 'invest' : 'accounts'} />
  )
  const screens: Record<Tab, ReactNode> = {
    home: <Home data={data} onDistribute={setDistribute} onOpenBudget={() => switchTo('budget')}
      onOpenCalendar={() => openPage('calendar')} onOpenBackup={() => openSection('backup')} onOpenAccounts={() => openPage('accounts')}
      onOpenAnalytics={() => openPage('analytics')} onOpenOps={openOps} onOpenGoals={() => openPage('goals')} onOpenPay={() => openSection('pay')} />,
    history: <History data={data} filter={opsFilter} setFilter={setOpsFilter} />,
    budget: <Budget data={data} onDistribute={setDistribute} onOpenOps={openOps} />,
    more: <More data={data} section={section} setSection={setSection} onOpenPage={openPage} />,
  }

  return (
    <div className={hidden ? 'app priv' : 'app'}>
      <main>
        {(Object.keys(screens) as Tab[]).map(t => (
          <div key={t} hidden={t !== tab}>
            <div ref={roots[t]} className="tab-root">
              <TopBar title={TAB_TITLE[t]} active={t === tab && !pushed[t]} />
              {screens[t]}
            </div>
            {pushed[t] && (
              <Pushed key={pushed[t]} title={PAGE_TITLE[pushed[t]!]} backLabel={TAB_TITLE[t]} under={roots[t]} closeSignal={t === tab ? closing : 0}
                onBack={() => setPushed(s => ({ ...s, [t]: null }))}>
                {page(pushed[t]!)}
              </Pushed>
            )}
          </div>
        ))}
      </main>

      {notice && (
        <div className="toast" role="status" key={notice.id}>
          {notice.undo ? notice.text : `✓ ${notice.text}`}
          {notice.undo && <button className="toast-undo" onClick={runUndo}>Отменить</button>}
        </div>
      )}
      {adding && (
        <Sheet title={adding.type === 'transfer' ? 'Перевод' : 'Добавить операцию'} full cancel onClose={() => setAdding(null)}>
          <Entry data={data} preset={adding} onSaved={onSaved} />
        </Sheet>
      )}
      {distribute && <Distribute data={data} tx={distribute} onClose={() => setDistribute(null)} />}

      <nav className="tabs" aria-label="Разделы">
        {TABS.map(t => t.id === 'add' ? (
          <button key="add" className="fab" aria-label="Добавить операцию" onClick={() => setAdding({})}><Icon name="plus" size={20} stroke={2.6} /></button>
        ) : (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => goTab(t.id as Tab)}>
            <Icon name={t.icon} size={22} stroke={tab === t.id ? 2.1 : 1.8} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
