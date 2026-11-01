import { useState, type ReactNode } from 'react'
import { saveSettings } from '../db'
import { bondEvents, type BondEvent } from '../domain/bonds'
import { envelopes, monthTotals, upcoming, type PlannedEvent } from '../domain/calc'
import { monthOf, plural, todayISO } from '../domain/money'
import { availableUntilNextIncome, inTotal } from '../domain/plan'
import { INCOME_LABEL, type Tx } from '../domain/types'
import { BondEventSheet } from './Bonds'
import { Empty, Money, Section, Sheet, setAmountsHidden, useAmountsHidden } from './common'
import { activeAccounts, type Data } from './data'
import { Icon } from './icons'
import { BondEventRow, CategoryRow, EventRow, EventSheet, TxRow, TxSheet, shortDate } from './rows'
import type { OpsFilter } from './History'

const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function Home({ data, onDistribute, onOpenBudget, onOpenCalendar, onOpenBackup, onOpenAccounts, onOpenAnalytics, onOpenOps, onOpenGoals, onOpenPay }: {
  data: Data
  onDistribute: (t: Tx) => void
  onOpenBudget: () => void
  onOpenCalendar: () => void
  onOpenBackup: () => void
  onOpenAccounts: () => void
  onOpenAnalytics: () => void
  onOpenOps: (f: OpsFilter) => void
  onOpenGoals: () => void
  onOpenPay: () => void
}) {
  const hidden = useAmountsHidden()
  const today = todayISO()
  const month = monthOf(today)
  const [ev, setEv] = useState<PlannedEvent | null>(null)
  const [bondEvent, setBondEvent] = useState<BondEvent | null>(null)
  const [tx, setTx] = useState<Tx | null>(null)
  const [availOpen, setAvailOpen] = useState(false)

  // Общий баланс — по счетам, отмеченным «учитывать в балансе»; валюты переводятся по курсу ЦБ.
  const all = activeAccounts(data.accounts)
  const counted = all.filter(inTotal)
  const total = counted.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const excluded = all.filter(a => !inTotal(a))
  const foreign = counted.some(a => a.currency !== 'RUB')

  const rubOf = (r: { amount: number; currency: 'RUB' | 'USD' | 'EUR' }) => data.toRub(r.amount, r.currency) ?? r.amount
  const avail = availableUntilNextIncome(data, data.bal, today, (v, a) => data.toRub(v, a.currency), rubOf)

  const totals = monthTotals(data.txs, month)
  const in45 = new Date(); in45.setDate(in45.getDate() + 31)
  const soon: ({ date: string; plan: PlannedEvent } | { date: string; bond: BondEvent })[] = [
    ...upcoming(data.recurring, data.settings, today, 31).map(plan => ({ date: plan.date, plan })),
    ...bondEvents(data.trades, data.bonds, today, todayISO(in45), data.taxFree).map(bond => ({ date: bond.date, bond })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)

  const attention = envelopes(data.categories, data.limits, data.txs, month)
    .filter(e => e.hasLimit && (e.spent > e.limit || (e.limit > 0 && e.spent / e.limit >= 0.85)))
    .sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit))
    .slice(0, 3)
  const recent = [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 4)
  const goals = data.progress.filter(p => p.remaining > 0 || p.saved > 0).slice(0, 3)

  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const WEEK = 7 * 864e5
  const exportStale = data.txs.length > 0
    && (!data.settings.lastExportAt || Date.now() - data.settings.lastExportAt > WEEK)
    && (!data.settings.backupNudgeAt || Date.now() - data.settings.backupNudgeAt > WEEK)
  const nextLabel = avail ? `${avail.next.kind === 'salary' ? 'зарплаты' : 'аванса'} ${shortDate(avail.next.date)}` : ''

  return (
    <div className="page">
      <div className="home-head">
        <span>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <button className="icon-btn" aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'} aria-pressed={hidden} onClick={() => setAmountsHidden(!hidden)}>
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={21} stroke={1.7} />
        </button>
      </div>

      <div className="card balance">
        <span className="cap">Общий баланс</span>
        <span className="big"><Money v={total} /></span>
        <button className="scope" onClick={onOpenAccounts}>
          {counted.length} из {all.length} {plural(all.length, ['счёта', 'счетов', 'счетов'])}
          {excluded.length > 0 && ` · без «${excluded[0].name}»${excluded.length > 1 ? ` и ещё ${excluded.length - 1}` : ''}`}
          {foreign && ' · валюта по курсу ЦБ'} ›
        </button>
        {avail ? (
          <button className="avail" onClick={() => setAvailOpen(true)}>
            <span>
              <span className="k">Доступно до {nextLabel}</span>
              <span className={`v ${avail.total < 0 ? 'neg' : ''}`}><Money v={avail.total} /></span>
              <span className="s">{avail.total > 0 ? <>≈ <Money v={avail.perDay} /> в день · </> : ''}{avail.days} {plural(avail.days, ['день', 'дня', 'дней'])}</span>
            </span>
            <Icon name="right" size={16} />
          </button>
        ) : (
          <button className="avail" onClick={onOpenPay}>
            <span><span className="k">Доступно до следующего дохода</span><span className="s">Отметь карты и дни выплат — и здесь появится сумма на каждый день</span></span>
            <Icon name="right" size={16} />
          </button>
        )}
      </div>

      {(pending.length > 0 || data.pendingBond.length > 0 || exportStale) && (
        <div className="list">
          {pending.map(t => (
            <button className="notice" key={t.id} onClick={() => onDistribute(t)}>
              <i className="dot" /><span className="body">Пришло: {INCOME_LABEL[t.incomeKind!].toLowerCase()} <Money v={t.rub} /> — сколько отложить</span><Icon name="right" size={14} />
            </button>
          ))}
          {data.pendingBond.slice(0, 3).map(e => (
            <button className="notice" key={e.key} onClick={() => setBondEvent(e)}>
              <i className="dot coupon" /><span className="body">{e.kind === 'coupon' ? 'Купон' : 'Погашение'} {e.shortName}{e.amount != null && <> — <Money v={e.amount} /></>} — записать</span><Icon name="right" size={14} />
            </button>
          ))}
          {exportStale && (
            <div className="notice">
              <i className="dot warn" />
              <button className="body" style={{ textAlign: 'left', minHeight: '2rem' }} onClick={onOpenBackup}>{data.settings.lastExportAt ? 'Бэкапа не было больше недели — сохрани Excel' : 'Сделай бэкап в Excel'}</button>
              <button className="icon-btn" style={{ marginRight: '-0.6rem' }} aria-label="Напомнить через неделю" onClick={() => saveSettings({ backupNudgeAt: Date.now() })}><Icon name="close" size={14} /></button>
            </div>
          )}
        </div>
      )}

      <Section title={MONTH_NOM[Number(month.slice(5)) - 1]} action="Аналитика" onAction={onOpenAnalytics} />
      <div className="trio">
        <button onClick={() => onOpenOps({ from: month, to: month })}><span className="k">Доходы</span><span className="v pos"><Money v={totals.income} sign /></span></button>
        <button onClick={() => onOpenOps({ from: month, to: month })}><span className="k">Расходы</span><span className="v">{totals.expense ? '−' : ''}<Money v={totals.expense} /></span></button>
        <div><span className="k">Разница</span><span className={`v ${totals.income - totals.expense < 0 ? 'neg' : ''}`}><Money v={totals.income - totals.expense} sign /></span></div>
      </div>

      <Section title="Ближайшее" action="Календарь" onAction={onOpenCalendar} />
      <div className="list">
        {soon.length === 0 && <Empty title="Ничего не запланировано">Добавь аренду и кредит в «Ещё → Регулярные платежи».</Empty>}
        {soon.map((it, i) => 'plan' in it ? <EventRow key={i} e={it.plan} data={data} onOpen={setEv} /> : <BondEventRow key={i} e={it.bond} onOpen={setBondEvent} />)}
      </div>

      {attention.length > 0 && (
        <>
          <Section title="Требуют внимания" action="Бюджет" onAction={onOpenBudget} />
          <div className="list">{attention.map(e => <CategoryRow key={e.category.id} e={e} onOpen={() => onOpenOps({ categoryId: e.category.id, from: month, to: month })} />)}</div>
        </>
      )}

      <Section title="Последние операции" action="Все" onAction={() => onOpenOps({})} />
      <div className="list">
        {recent.length === 0 && <Empty title="Операций пока нет">Нажми «+» внизу, чтобы записать первую.</Empty>}
        {recent.map(t => <TxRow key={t.id} data={data} t={t} onOpen={setTx} />)}
      </div>

      {goals.length > 0 && (
        <>
          <Section title="Цели" action="Все" onAction={onOpenGoals} />
          <div className="list">
            {goals.map(p => {
              const a = data.accounts.find(x => x.id === p.goal.accountId)
              const pct = p.goal.target > 0 ? Math.min(100, Math.floor((p.saved / p.goal.target) * 100)) : 0
              return (
                <button className="row" key={p.goal.id} onClick={onOpenGoals}>
                  <span className="body">
                    <span className="title">{p.goal.name}</span>
                    <span className="sub">{pct}%{p.goal.deadline ? ` · до ${new Date(p.goal.deadline + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}` : ''}</span>
                    <span className="bar" style={{ display: 'block' }}><span className="fill" style={{ display: 'block', width: `${Math.max(pct, p.saved > 0 ? 1 : 0)}%` }} /></span>
                  </span>
                  <span className="amt"><Money v={p.saved} cur={a?.currency} /><span className="sub">из <Money v={p.goal.target} cur={a?.currency} /></span></span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {availOpen && avail && (
        <Sheet title={`Доступно до ${nextLabel}`} onClose={() => setAvailOpen(false)}>
          <div className="kv">
            {avail.cash.map(c => <FragmentRow key={c.account.id} k={`На карте «${c.account.name}»`} v={<Money v={c.rub} />} />)}
            {avail.due.map((d, i) => <FragmentRow key={`d${i}`} k={`${d.recurring.name}, ${shortDate(d.date)}${d.late ? ' — просрочен' : ''}`} v={<span className={d.late ? 'neg' : ''}>−<Money v={d.rub} /></span>} />)}
            {avail.skipped.map((d, i) => <FragmentRow key={`s${i}`} k={`${d.recurring.name}, ${shortDate(d.date)} — ${d.reason === 'paid' ? 'уже оплачен' : 'отложено на копилке'}`} v={<span className="muted">не вычитается</span>} />)}
            <span className="tot">Можно тратить</span><span className={`tot ${avail.total < 0 ? 'neg' : ''}`}><Money v={avail.total} /></span>
          </div>
          <p className="hint">Считаются только собственные деньги на картах, отмеченных «учитывать в балансе». Копилки, облигации и отложенное под платежи — резерв, их здесь нет. Плановая выплата — не деньги, пока не пришла.{foreign && ' Валюта переведена по курсу ЦБ.'}</p>
          <button className="secondary" onClick={() => { setAvailOpen(false); onOpenAccounts() }}>Какие счета учитывать</button>
        </Sheet>
      )}
      {ev && <EventSheet data={data} e={ev} onClose={() => setEv(null)} onOpenTx={setTx} />}
      {tx && <TxSheet data={data} tx={tx} onClose={() => setTx(null)} />}
      {bondEvent && <BondEventSheet data={data} event={bondEvent} onClose={() => setBondEvent(null)} />}
    </div>
  )
}

function FragmentRow({ k, v }: { k: string; v: ReactNode }) {
  return <><span className="k">{k}</span><span className="money-cell">{v}</span></>
}
