import { useEffect, useRef, useState } from 'react'
import type { LockRow } from './db'
import type { Tx } from './domain/types'
import { getLock, isLockEnabled } from './lock'
import { Accounts } from './ui/Accounts'
import { Analytics } from './ui/Analytics'
import { Budget } from './ui/Budget'
import { Calendar } from './ui/Calendar'
import { Sheet } from './ui/common'
import { useData } from './ui/data'
import { Distribute } from './ui/Distribute'
import { Entry } from './ui/Entry'
import { History } from './ui/History'
import { Home } from './ui/Home'
import { Icon, type IconName } from './ui/icons'
import { LockScreen } from './ui/Lock'
import { More, type MorePage, type MoreSection } from './ui/More'

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
  const [adding, setAdding] = useState(false)
  const [editTx, setEditTx] = useState<Tx | null>(null)
  const [lock, setLock] = useState<LockRow | null>(null)
  const [locked, setLocked] = useState(true)
  const [toast, setToast] = useState('')
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
    setAdding(false)
    setEditTx(null)
    if (tx.type === 'income') setDistribute(tx)
    setToast('Сохранено')
    setTimeout(() => setToast(''), 1500)
  }
  const openMore = (p: MorePage | null, s: MoreSection | null = null) => { setTab('more'); setMorePage(p); setSection(s) }

  return (
    <div className="app">
      <main>
        {tab === 'home' && (
          <Home data={data} onDistribute={setDistribute} onOpenBudget={() => setTab('budget')}
            onOpenCalendar={() => openMore('calendar')} onOpenBackup={() => openMore(null, 'backup')} onOpenTx={setEditTx} />
        )}
        {tab === 'history' && <History data={data} />}
        {tab === 'budget' && <Budget data={data} onDistribute={setDistribute} />}
        {tab === 'more' && morePage && (
          <div>
            <div className="page" style={{ paddingBottom: 0 }}>
              <button className="back" onClick={() => setMorePage(null)}><Icon name="left" size={20} /> Ещё</button>
            </div>
            <div style={{ marginTop: -18 }}>
              {morePage === 'calendar' && <Calendar data={data} />}
              {morePage === 'analytics' && <Analytics data={data} />}
              {morePage === 'accounts' && <Accounts data={data} />}
            </div>
          </div>
        )}
        {tab === 'more' && !morePage && <More data={data} section={section} setSection={setSection} onOpenPage={setMorePage} />}
      </main>

      {toast && <div className="toast">✓ {toast}</div>}
      {adding && (
        <Sheet title="Новая операция" full onClose={() => setAdding(false)}>
          <Entry data={data} onSaved={onSaved} />
        </Sheet>
      )}
      {editTx && (
        <Sheet title="Операция" onClose={() => setEditTx(null)}>
          <Entry data={data} tx={editTx} onSaved={onSaved} />
        </Sheet>
      )}
      {distribute && <Distribute data={data} tx={distribute} onClose={() => setDistribute(null)} />}

      <nav className="tabs">
        {TABS.map(t => t.id === 'add' ? (
          <button key="add" className="fab" aria-label="Добавить операцию" onClick={() => setAdding(true)}><Icon name="plus" size={28} stroke={2.4} /></button>
        ) : (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id as Tab); if (t.id === 'more') setMorePage(null) }}>
            <Icon name={t.icon} size={24} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
