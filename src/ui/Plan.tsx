import { useState } from 'react'
import { eventTitle, plannedInMonth, type PlannedEvent } from '../domain/calc'
import { extraTx } from '../domain/pay'
import { monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { eventStatus, incomeTx } from '../domain/plan'
import type { Recurring, Tx } from '../domain/types'
import { BigMoney, Empty, Money, Section, Sheet } from './common'
import type { Data } from './data'
import { Icon } from './icons'
import { RecurringForm, RecurringSection } from './More'
import { useMonthSlide } from './nav'
import { EventRow, EventSheet, TxSheet } from './rows'

/** План платежей месяца: обязательства, поступления, статусы оплаты и пополнения копилок. */
export function Plan({ data }: { data: Data }) {
  const today = todayISO()
  const [month, setMonth] = useState(monthOf(today))
  const [ev, setEv] = useState<PlannedEvent | null>(null)
  const [tx, setTx] = useState<Tx | null>(null)
  const [edit, setEdit] = useState<Partial<Recurring> | 'all' | null>(null)
  const slide = useMonthSlide(month)

  const rubOf = (r: Recurring) => data.toRub(r.amount, r.currency) ?? r.amount
  const events = plannedInMonth(data.recurring, data.settings, month)
  const payments = events.filter(e => e.kind === 'payment') as Extract<PlannedEvent, { kind: 'payment' }>[]
  const incomes = events.filter(e => e.kind !== 'payment') as Exclude<PlannedEvent, { kind: 'payment' }>[]
  const status = (e: PlannedEvent) => eventStatus(e, data.txs, today, rubOf)
  const total = payments.reduce((s, e) => s + rubOf(e.recurring), 0)
  const paid = payments.filter(e => status(e) === 'done').reduce((s, e) => s + rubOf(e.recurring), 0)
  const late = payments.filter(e => status(e) === 'late')
  const expected = incomes.reduce((s, e) => s + e.amount, 0)
  const topups = data.recurring.filter(r => r.active && r.kind === 'topup')

  return (
    <div className="page">
      <div className="page-head">
        <h1>План платежей</h1>
        <div className="head-actions">
          <button className="round-btn accent" aria-label="Новый платёж" onClick={() => setEdit({ kind: 'payment', currency: 'RUB', fundFrom: 'salary', active: true })}><Icon name="plus" size={20} stroke={2.2} /></button>
        </div>
      </div>
      <div className="cal-head" style={{ marginBottom: '0.4rem' }}>
        <strong aria-live="polite">{monthLabel(month)}</strong>
        <span>
          <button className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setMonth(m => shiftMonth(m, -1))}><Icon name="left" size={18} /></button>
          <button className="icon-btn" aria-label="Следующий месяц" onClick={() => setMonth(m => shiftMonth(m, 1))}><Icon name="right" size={18} /></button>
        </span>
      </div>

      <div ref={slide}>
        <section className="hero plan-hero">
          <div className="plan-hero-grid">
            <div>
              <span className="cap">Обязательные платежи</span>
              <BigMoney v={total} className="hero-v" />
              <span className="hero-day">{payments.length ? `${payments.length} в этом месяце` : 'не запланированы'}</span>
            </div>
            <div className="plan-paid">
              <span className="cap">Оплачено</span>
              <span className="plan-paid-v"><Icon name="check" size={16} stroke={2.6} /><Money v={paid} whole /></span>
              <span className="hero-day">{late.length ? <span className="neg">просрочено: {late.length}</span> : total > paid ? <>осталось <Money v={total - paid} whole /></> : total ? 'всё оплачено' : ''}</span>
            </div>
          </div>
          {total > 0 && (
            <span className="budget-bar" style={{ margin: '0 1.05rem 0.9rem', width: 'auto' }} aria-hidden="true">
              {paid > 0 && <i className="paid" style={{ flexGrow: paid }} />}
              {total > paid && <i className="left" style={{ flexGrow: total - paid }} />}
            </span>
          )}
        </section>

        <Section title="Поступления на месяц" extra={expected ? <span className="small muted">всего <Money v={expected} whole /></span> : undefined} />
        <div className="list">
          {incomes.map(e => {
            const got = e.kind === 'extra' ? extraTx(e, data.txs) : incomeTx(e.kind, e.date, data.txs)
            const pct = e.amount > 0 ? Math.min(100, ((got?.rub ?? 0) / e.amount) * 100) : got ? 100 : 0
            return (
              <button key={e.kind === 'extra' ? e.name + e.date : e.kind} className="row inc-row" style={{ padding: '0.5rem 0.82rem' }} onClick={() => setEv(e)}>
                <span className="body">
                  <span className="goal-line"><span className="title">{eventTitle(e)} <span className="muted small">{new Date(e.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></span>
                    <span className="cat-amt">{e.amount ? <Money v={e.amount} whole /> : 'сумма не задана'}</span></span>
                  <span className="goal-line"><span className="bar"><span className="fill" style={{ display: 'block', width: `${pct}%`, background: 'var(--pos)' }} /></span><span className="pct">{got ? 'пришло' : 'ожидается'}</span></span>
                </span>
              </button>
            )
          })}
          {expected === 0 && <p className="hint" style={{ padding: '0 0.82rem 0.6rem' }}>Суммы зарплаты, аванса, премии и других выплат задаются в «Ещё → Выплаты». Плановые поступления не прибавляются к балансу, пока не придут.</p>}
        </div>

        <Section title="Запланированные платежи" action="Изменить" onAction={() => setEdit('all')} />
        <div className="list">
          {payments.length === 0 && <Empty title="Платежей нет">Нажми «+», чтобы добавить аренду, кредит или подписку.</Empty>}
          {payments.map(e => <EventRow key={e.recurring.id} e={e} data={data} onOpen={setEv} />)}
        </div>
        <p className="hint">Оплаченный платёж отмечается по операции в его категории — второй раз из «Доступно» он не вычитается.</p>

        {topups.length > 0 && (
          <>
            <Section title="Пополнения копилок" />
            <div className="list">
              {topups.map(r => {
                const acc = data.accounts.find(a => a.id === r.reserveAccountId)
                const inMonth = data.txs.filter(t => t.type === 'transfer' && t.toAccountId === r.reserveAccountId && monthOf(t.date) === month).reduce((s, t) => s + (t.toAmount ?? t.amount), 0)
                return (
                  <button key={r.id} className="row" style={{ padding: '0.5rem 0.82rem' }} onClick={() => setEdit(r)}>
                    <span className="body">
                      <span className="goal-line"><span className="title">{acc?.name ?? r.name}</span><span className="cat-amt"><Money v={Math.min(inMonth, r.amount)} whole /><span className="muted"> из <Money v={r.amount} whole /></span></span></span>
                      <span className="goal-line"><span className="bar"><span className="fill" style={{ display: 'block', width: `${Math.min(100, (inMonth / r.amount) * 100)}%` }} /></span><span className="pct">{inMonth >= r.amount ? 'готово' : `${Math.floor((inMonth / r.amount) * 100)}%`}</span></span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {ev && <EventSheet data={data} e={ev} onClose={() => setEv(null)} onOpenTx={setTx} />}
      {tx && <TxSheet data={data} tx={tx} onClose={() => setTx(null)} />}
      {edit === 'all' && <Sheet title="Регулярные платежи" onClose={() => setEdit(null)}><RecurringSection data={data} /></Sheet>}
      {edit && edit !== 'all' && (
        <Sheet title={edit.id ? 'Изменить' : edit.kind === 'topup' ? 'Пополнение копилки' : 'Новый платёж'} onClose={() => setEdit(null)}>
          <RecurringForm data={data} r={edit} onDone={() => setEdit(null)} />
        </Sheet>
      )}
    </div>
  )
}
