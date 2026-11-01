import { useEffect, useRef, useState } from 'react'
import type { LockRow } from './db'
import type { Tx } from './domain/types'
import { monthOf, todayISO } from './domain/money'
import { getLock, isLockEnabled } from './lock'
import { Accounts, type EntryPreset } from './ui/Accounts'
import { Analytics } from './ui/Analytics'
import { Budget } from './ui/Budget'
import { Calendar } from './ui/Calendar'
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

type Tab = 'home' | 'history' | 'budget' | 'more'
const TABS: { id: Tab | 'add'; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'history', label: 'Операции', icon: 'list' },
  { id: 'add', label: '', icon: 'plus' },
  { id: 'budget', label: 'Бюджет', icon: 'pie' },
  { id: 'more', label: 'Ещё', icon: 'more' },
]
const RELOCK_AFTER_MS = 60_000

export default function App() {
  const data = useData()
  const [tab, setTab] = useState<Tab>('home')
  const [morePage, setMorePage] = useState<MorePage | null>(null)
  const [section, setSection] = useState<MoreSection | null>(null)
  const [adding, setAdding] = useState<EntryPreset | null>(null)
  const hidden = useAmountsHidden()
  // Откуда открыт подраздел «Ещё» — туда и ведёт «Назад».
  const [backTo, setBackTo] = useState<Tab>('more')
  const [lock, setLock] = useState<LockRow | null>(null)
  const [locked, setLocked] = useState(true)
  const [opsFilter, setOpsFilter] = useState<OpsFilter>({})
  const notice = useNotice()
  const [distribute, setDistribute] = useState<Tx | null>(null)
  const hiddenAt = useRef<number | null>(null)

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

  useEffect(() => { window.scrollTo(0, 0) }, [tab, morePage])

  if (!lock || !data) return null
  if (locked && isLockEnabled(lock)) return <LockScreen lock={lock} onUnlock={() => setLocked(false)} />

  function onSaved(tx: Tx) {
    setAdding(null)
    if (tx.type === 'income') setDistribute(tx)
    notify('Сохранено')
  }
  const openMore = (p: MorePage | null, s: MoreSection | null = null) => { setBackTo(tab === 'more' ? 'more' : tab); setTab('more'); setMorePage(p); setSection(s) }
  const thisMonth = monthOf(todayISO())
  const openOps = (f: OpsFilter) => { setOpsFilter(f); setTab('history') }
  const goTab = (t: Tab) => {
    setTab(t)
    if (t === 'more') setMorePage(null)
    if (t === 'history') setOpsFilter({ from: thisMonth, to: thisMonth })
  }
  const back = () => { if (backTo === 'more') setMorePage(null); else { setTab(backTo); setMorePage(null) } }
  const backLabel = backTo === 'home' ? 'Главная' : backTo === 'budget' ? 'Бюджет' : backTo === 'history' ? 'Операции' : 'Ещё'

  return (
    <div className={hidden ? 'app priv' : 'app'}>
      <main>
        {tab === 'home' && (
          <Home data={data} onDistribute={setDistribute} onOpenBudget={() => goTab('budget')}
            onOpenCalendar={() => openMore('calendar')} onOpenBackup={() => openMore(null, 'backup')} onOpenAccounts={() => openMore('accounts')}
            onOpenAnalytics={() => openMore('analytics')} onOpenOps={openOps} onOpenGoals={() => openMore('goals')} onOpenPay={() => openMore(null, 'pay')} />
        )}
        {tab === 'history' && <History data={data} filter={opsFilter} setFilter={setOpsFilter} />}
        {tab === 'budget' && <Budget data={data} onDistribute={setDistribute} onOpenOps={openOps} />}
        {tab === 'more' && morePage && (
          <div>
            <div className="page" style={{ paddingBottom: 0 }}>
              <button className="back" onClick={back}><Icon name="left" size={18} /> {backLabel}</button>
            </div>
            <div style={{ marginTop: '-1.4rem' }}>
              {morePage === 'calendar' && <Calendar data={data} />}
              {morePage === 'analytics' && <Analytics data={data} onOpenOps={openOps} />}
              {(morePage === 'accounts' || morePage === 'goals' || morePage === 'invest') && (
                <Accounts key={morePage} data={data} onOpenOps={openOps} onAdd={setAdding}
                  initialTab={morePage === 'goals' ? 'goals' : morePage === 'invest' ? 'invest' : 'accounts'} />
              )}
            </div>
          </div>
        )}
        {tab === 'more' && !morePage && <More data={data} section={section} setSection={setSection} onOpenPage={p => { setBackTo('more'); setMorePage(p) }} />}
      </main>

      {notice && (
        <div className="toast" role="status" key={notice.id}>
          {notice.undo ? notice.text : `✓ ${notice.text}`}
          {notice.undo && <button className="toast-undo" onClick={runUndo}>Отменить</button>}
        </div>
      )}
      {adding && (
        <Sheet title={adding.type === 'transfer' ? 'Перевод' : 'Новая операция'} full onClose={() => setAdding(null)}>
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
