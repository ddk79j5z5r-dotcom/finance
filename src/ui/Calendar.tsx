import { useState } from 'react'
import { bondEvents, type BondEvent } from '../domain/bonds'
import { plannedInMonth, type PlannedEvent } from '../domain/calc'
import { monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { eventStatus } from '../domain/plan'
import type { Recurring, Tx } from '../domain/types'
import { BondEventSheet } from './Bonds'
import { Empty, MonthNav, Section, Segmented } from './common'
import type { Data } from './data'
import { BondEventRow, EventRow, EventSheet, TxRow, TxSheet } from './rows'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function Calendar({ data }: { data: Data }) {
  const today = todayISO()
  const [month, setMonth] = useState(monthOf(today))
  const [selected, setSelected] = useState(today)
  const [mode, setMode] = useState<'day' | 'month'>('day')
  const [ev, setEv] = useState<PlannedEvent | null>(null)
  const [bond, setBond] = useState<BondEvent | null>(null)
  const [tx, setTx] = useState<Tx | null>(null)

  const [y, m] = month.split('-').map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7 // понедельник — первый
  const days = new Date(y, m, 0).getDate()
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => todayISO(new Date(y, m - 1, i - lead + 1)))

  const rubOf = (r: Recurring) => data.toRub(r.amount, r.currency) ?? r.amount
  const events = plannedInMonth(data.recurring, data.settings, month)
  const lastDay = `${month}-${String(days).padStart(2, '0')}`
  const bondEv = bondEvents(data.trades, data.bonds, `${month}-01`, lastDay, data.taxFree)
  const txDays = new Set(data.txs.filter(t => monthOf(t.date) === month).map(t => t.date))

  const go = (delta: number) => {
    const next = shiftMonth(month, delta)
    setMonth(next)
    setSelected(monthOf(today) === next ? today : `${next}-01`)
  }
  const list = mode === 'day' ? events.filter(e => e.date === selected) : events
  const listBond = mode === 'day' ? bondEv.filter(e => e.date === selected) : bondEv
  const dayTxs = mode === 'day' ? data.txs.filter(t => t.date === selected) : []
  const selLabel = new Date(selected + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })

  return (
    <div className="page">
      <div className="page-head"><h1>Календарь</h1></div>
      <div className="card" style={{ padding: '0.2rem 0.4rem 0.5rem' }}>
        <MonthNav label={monthLabel(month)} onPrev={() => go(-1)} onNext={() => go(1)} />
        <div className="cal" role="grid" aria-label={monthLabel(month)}>
          {WEEKDAYS.map(w => <div className="wd" key={w}>{w}</div>)}
          {cells.map(d => {
            const inMonth = monthOf(d) === month
            const ev = inMonth ? events.filter(e => e.date === d) : []
            const bev = inMonth ? bondEv.filter(e => e.date === d) : []
            const statuses = ev.map(e => ({ e, s: eventStatus(e, data.txs, today, rubOf) }))
            const cls = [!inMonth && 'out', d === today && 'today', d === selected && 'sel'].filter(Boolean).join(' ')
            const count = ev.length + bev.length
            return (
              <button key={d} className={cls} disabled={!inMonth} aria-pressed={d === selected}
                onClick={() => { setSelected(d); setMode('day') }}
                aria-label={`${Number(d.slice(8))}${d === today ? ', сегодня' : ''}${count ? `, событий: ${count}` : ''}`}>
                <span className="d">{Number(d.slice(8))}</span>
                <span className="dots" aria-hidden="true">
                  {statuses.some(x => x.e.kind === 'payment' && x.s === 'late') && <i style={{ background: 'var(--neg)' }} />}
                  {statuses.some(x => x.e.kind === 'payment' && x.s !== 'late') && <i style={{ background: 'var(--text-2)' }} />}
                  {statuses.some(x => x.e.kind !== 'payment') && <i style={{ background: 'var(--pos)' }} />}
                  {bev.length > 0 && <i style={{ background: 'var(--coupon)' }} />}
                  {count === 0 && inMonth && txDays.has(d) && <i style={{ background: 'var(--s3)' }} />}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--pos)' }} />поступление</span>
        <span><i style={{ background: 'var(--text-2)' }} />платёж</span>
        <span><i style={{ background: 'var(--neg)' }} />просрочено</span>
        <span><i style={{ background: 'var(--coupon)' }} />купон</span>
      </div>

      <div style={{ marginTop: '0.8rem' }}>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'day', label: selLabel[0].toUpperCase() + selLabel.slice(1) }, { value: 'month', label: 'Весь месяц' }]} />
      </div>
      <div className="list">
        {list.length === 0 && listBond.length === 0 && <Empty title="Ничего не запланировано">{mode === 'day' ? 'В этот день платежей и поступлений нет.' : 'В этом месяце нет плановых событий.'}</Empty>}
        {[...list.map(e => ({ date: e.date, el: <EventRow key={`p${e.date}${e.kind === 'payment' ? e.recurring.id : e.kind}`} e={e} data={data} onOpen={setEv} /> })),
          ...listBond.map(e => ({ date: e.date, el: <BondEventRow key={e.key} e={e} onOpen={setBond} /> }))]
          .sort((a, b) => a.date.localeCompare(b.date)).map(x => x.el)}
      </div>
      {dayTxs.length > 0 && (
        <>
          <Section title="Операции дня" />
          <div className="list">{dayTxs.map(t => <TxRow key={t.id} data={data} t={t} onOpen={setTx} />)}</div>
        </>
      )}

      {ev && <EventSheet data={data} e={ev} onClose={() => setEv(null)} onOpenTx={setTx} />}
      {bond && <BondEventSheet data={data} event={bond} onClose={() => setBond(null)} />}
      {tx && <TxSheet data={data} tx={tx} onClose={() => setTx(null)} />}
    </div>
  )
}
