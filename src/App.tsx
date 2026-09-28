import { useEffect, useRef, useState } from 'react'
import type { LockRow } from './db'
import type { Tx } from './domain/types'
import { getLock, isLockEnabled } from './lock'
import { Accounts } from './ui/Accounts'
import { useData } from './ui/data'
import { Distribute } from './ui/Distribute'
import { Entry } from './ui/Entry'
import { History } from './ui/History'
import { LockScreen } from './ui/Lock'
import { Month } from './ui/Month'
import { More, type MoreSection } from './ui/More'

type Tab = 'entry' | 'month' | 'history' | 'accounts' | 'more'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'entry', label: 'Ввод', icon: '＋' },
  { id: 'month', label: 'Месяц', icon: '◔' },
  { id: 'history', label: 'Операции', icon: '☰' },
  { id: 'accounts', label: 'Счета', icon: '◎' },
  { id: 'more', label: 'Ещё', icon: '⋯' },
]
const RELOCK_AFTER_MS = 60_000

export default function App() {
  const data = useData()
  const [tab, setTab] = useState<Tab>('entry')
  const [section, setSection] = useState<MoreSection | null>(null)
  const [lock, setLock] = useState<LockRow | null>(null)
  const [locked, setLocked] = useState(true)
  const [justSaved, setJustSaved] = useState('')
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

  if (!lock || !data) return null
  if (locked && isLockEnabled(lock)) return <LockScreen lock={lock} onUnlock={() => setLocked(false)} />

  function onSaved(tx: Tx) {
    if (tx.type === 'income') setDistribute(tx)
    setJustSaved('Записано')
    setTimeout(() => setJustSaved(''), 1500)
  }

  return (
    <div className="app">
      <main>
        {tab === 'entry' && <div className="page"><Entry data={data} onSaved={onSaved} /></div>}
        {tab === 'month' && <Month data={data} onOpenBackup={() => { setTab('more'); setSection('backup') }} />}
        {tab === 'history' && <History data={data} />}
        {tab === 'accounts' && <Accounts data={data} />}
        {tab === 'more' && <More data={data} section={section} setSection={setSection} />}
      </main>
      {justSaved && <div className="toast">✓ {justSaved}</div>}
      {distribute && <Distribute data={data} tx={distribute} onClose={() => setDistribute(null)} />}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
