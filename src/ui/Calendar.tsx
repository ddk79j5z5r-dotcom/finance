import { useState } from 'react'
import { plannedInMonth } from '../domain/calc'
import { monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { Money, MonthNav } from './common'
import { txView, type Data } from './data'
import { BondEventRow, EventRow } from './Home'
import { bondEvents } from '../domain/bonds'
import { Badge } from './icons'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function Calendar({ data }: { data: Data }) {
  const today = todayISO()
  const [month, setMonth] = useState(monthOf(today))
  const [selected, setSelected] = useState<string | null>(null)

  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7 // понедельник — первый
  const days = new Date(y, m, 0).getDate()
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
    const d = new Date(y, m - 1, i - lead + 1)
    return todayISO(d)
  })

  const events = plannedInMonth(data.recurring, data.settings, month)
  const lastDay = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const bondEv = bondEvents(data.trades, data.bonds, `${month}-01`, lastDay, data.taxFree)
  const txDays = new Set(data.txs.filter(t => monthOf(t.date) === month).map(t => t.date))
  const dayEvents = selected ? events.filter(e => e.date === selected) : events
  const dayBond = selected ? bondEv.filter(e => e.date === selected) : bondEv
  const dayTxs = selected ? data.txs.filter(t => t.date === selected) : []

  function go(delta: number) {
    setMonth(mm => shiftMonth(mm, delta))
    setSelected(null)
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Календарь</h1></div>
      <MonthNav label={monthLabel(month)} onPrev={() => go(-1)} onNext={() => go(1)} />
      <div className="card">
        <div className="cal">
          {WEEKDAYS.map(w => <div className="wd" key={w}>{w}</div>)}
          {cells.map(d => {
            const inMonth = monthOf(d) === month
            const ev = inMonth ? events.filter(e => e.date === d) : []
            const bev = inMonth && bondEv.some(e => e.date === d)
            const cls = [!inMonth && 'out', d === today && 'today', d === selected && 'sel'].filter(Boolean).join(' ')
            return (
              <button key={d} className={cls} disabled={!inMonth} onClick={() => setSelected(s => (s === d ? null : d))}
                aria-label={`${Number(d.slice(8))}${ev.length ? `, событий: ${ev.length}` : ''}`}>
                {Number(d.slice(8))}
                <span className="dots">
                  {ev.some(e => e.kind === 'payment') && <i className="dot-pay" />}
                  {(ev.some(e => e.kind !== 'payment') || bev) && <i className="dot-inc" />}
                  {inMonth && !ev.length && !bev && txDays.has(d) && <i className="dot-tx" />}
                </span>
              </button>
            )
          })}
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--neg)' }} />платёж</span>
          <span><i style={{ background: 'var(--pos)' }} />выплата, купон</span>
          <span><i style={{ background: 'var(--muted)' }} />были операции</span>
        </div>
      </div>

      <div className="section-title">
        <h3>{selected ? new Date(selected + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'События месяца'}</h3>
        {selected && <button className="link" onClick={() => setSelected(null)}>Весь месяц</button>}
      </div>
      <div className="card tight">
        {dayEvents.length === 0 && dayBond.length === 0 && dayTxs.length === 0 && <p className="hint">Ничего не запланировано.</p>}
        {[...dayEvents.map(e => ({ date: e.date, el: <EventRow key={`p${e.date}${e.kind === 'payment' ? e.recurring.id : e.kind}`} e={e} data={data} today={today} /> })),
          ...dayBond.map(e => ({ date: e.date, el: <BondEventRow key={e.key} e={e} today={today} /> }))]
          .sort((a, b) => a.date.localeCompare(b.date)).map(x => x.el)}
        {dayTxs.map(t => {
          const v = txView(data, t)
          const acc = data.accounts.find(a => a.id === t.accountId)
          return (
            <div className="row" key={t.id}>
              <Badge icon={v.icon} tone={v.tone} />
              <div className="body"><div className="title">{v.title}</div><div className="sub">{v.sub}</div></div>
              <div className={`amt ${t.type === 'income' ? 'pos' : ''}`}>{t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}<Money v={t.amount} cur={acc?.currency} /></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
