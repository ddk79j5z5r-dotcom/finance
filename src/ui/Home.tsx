import { useState, type ReactNode } from 'react'
import { saveSettings } from '../db'
import type { BondEvent } from '../domain/bonds'
import { accountKind, envelopes, eventTitle, monthTotals, upcoming, type PlannedEvent } from '../domain/calc'
import { monthLabel, monthOf, plural, todayISO } from '../domain/money'
import { availableUntilNextIncome, eventStatus, inTotal } from '../domain/plan'
import { INCOME_LABEL, type Recurring, type Tx } from '../domain/types'
import { BondEventSheet } from './Bonds'
import { BigMoney, Empty, Money, Section, Sheet, setAmountsHidden, useAmountsHidden } from './common'
import { activeAccounts, type Data } from './data'
import { Icon } from './icons'
import { CategoryRow, EventSheet, GoalRow, TxRow, TxSheet, shortDate } from './rows'
import type { OpsFilter } from './History'

const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

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

  const attention = envelopes(data.categories, data.limits, data.txs, month)
    .filter(e => e.hasLimit && (e.spent > e.limit || (e.limit > 0 && e.spent / e.limit >= 0.85)))
    .sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit))
    .slice(0, 3)
  const recent = [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 3)
  const goals = data.progress.filter(p => p.remaining > 0 || p.saved > 0).slice(0, 3)

  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const WEEK = 7 * 864e5
  const exportStale = data.txs.length > 0
    && (!data.settings.lastExportAt || Date.now() - data.settings.lastExportAt > WEEK)
    && (!data.settings.backupNudgeAt || Date.now() - data.settings.backupNudgeAt > WEEK)
  const nextLabel = avail ? `${avail.next.kind === 'salary' ? 'зарплаты' : 'аванса'} ${shortDate(avail.next.date)}` : ''

  // Шкала ближайшего: сегодня и следующие даты с поступлениями и неоплаченными платежами (до трёх).
  const timeline = (() => {
    const byDate = new Map<string, PlannedEvent[]>()
    for (const e of upcoming(data.recurring, data.settings, today, 31)) {
      if (eventStatus(e, data.txs, today, rubOf) === 'done') continue
      if (e.kind !== 'payment' && e.amount <= 0 && e.kind !== avail?.next.kind) continue
      byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
    }
    // Поступления и платежи одного дня — отдельными точками: плюс и минус не смешиваются в одну сумму.
    const pts: { key: string; date: string; label: string; sum: number; known: boolean }[] = []
    for (const [date, evs] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
      const incomes = evs.filter(e => e.kind !== 'payment') as Exclude<PlannedEvent, { kind: 'payment' }>[]
      const pays = evs.filter(e => e.kind === 'payment') as { recurring: Recurring }[]
      if (incomes.length) {
        // Зарплата и премия в один день — одной точкой: «Зарплата + премия».
        const main = incomes.find(e => e.kind !== 'extra') ?? incomes[0]
        const rest = incomes.filter(e => e !== main)
        // Премия «с зарплатой» входит в её сумму — подписываем, чтобы было видно.
        const withPremium = main.kind === 'salary' && !!data.settings.pay?.premium?.value && !data.settings.pay.premium.day
        const label = eventTitle(main) + (withPremium && !rest.length ? ' + премия' : '') + (rest.length === 1 ? ` + ${eventTitle(rest[0]).toLowerCase()}` : rest.length > 1 ? ` + ещё ${rest.length}` : '')
        pts.push({ key: `${date}+`, date, label, sum: incomes.reduce((s, e) => s + e.amount, 0), known: incomes.every(e => e.amount > 0) })
      }
      if (pays.length) pts.push({ key: `${date}-`, date, label: pays.length === 1 ? pays[0].recurring.name : `Платежи · ${pays.length}`, sum: -pays.reduce((s, e) => s + rubOf(e.recurring), 0), known: true })
    }
    return pts
  })()

  // Распределение собственных денег: на жизнь (карты), цели (накопленное на копилках с целью), резерв (остальное).
  const goalAcc = new Set(data.goals.map(g => g.accountId))
  const split = counted.reduce((s, a) => {
    const v = Math.max(0, data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0)
    const k = accountKind(a)
    if (k === 'credit') return s
    if (k === 'card') s.life += v
    else if (goalAcc.has(a.id!)) s.goals += v
    else s.reserve += v
    return s
  }, { life: 0, reserve: 0, goals: 0 })
  const splitTotal = split.life + split.reserve + split.goals
  const pctOf = (v: number) => (splitTotal ? Math.round((v / splitTotal) * 100) : 0)
  const monthIn = MONTH_IN[Number(month.slice(5)) - 1]

  return (
    <div className="page home">
      <div className="page-head">
        <div>
          <h1>Финансы</h1>
          <span className="sub">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <button className="round-btn" aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'} aria-pressed={hidden} onClick={() => setAmountsHidden(!hidden)}>
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} stroke={1.8} />
        </button>
      </div>

      <section className="hero">
        {avail ? (
          <button className="hero-main" onClick={() => setAvailOpen(true)} aria-label={`Доступно до ${nextLabel}. Как посчитано`}>
            <span className="cap">Доступно до {nextLabel}</span>
            <BigMoney v={avail.total} className={avail.total < 0 ? 'hero-v neg' : 'hero-v'} />
            <span className="hero-day">
              {avail.total > 0 ? <>≈ <b><Money v={avail.perDay} /></b> в день · </> : avail.total < 0 ? 'Не хватает до выплаты · ' : 'Свободных денег нет · '}{avail.days} {plural(avail.days, ['день', 'дня', 'дней'])}
              <Icon name="right" size={14} />
            </span>
          </button>
        ) : (
          <button className="hero-main" onClick={onOpenPay}>
            <span className="cap">Доступно до следующего дохода</span>
            <span className="hero-setup">Укажи дни выплат и отметь карты — здесь появится сумма на каждый день</span>
            <span className="hero-day accent">Настроить <Icon name="right" size={14} /></span>
          </button>
        )}
        <button className="hero-total" onClick={onOpenAccounts}>
          <span>
            Всего на счетах
            <span className="hero-scope">{counted.length} из {all.length} {plural(all.length, ['счёта', 'счетов', 'счетов'])}{excluded.length > 0 ? ' в сумме' : ''}{foreign ? ' · валюта по курсу ЦБ' : ''}</span>
          </span>
          <span className="hero-total-v"><Money v={total} whole /><Icon name="right" size={14} /></span>
        </button>
      </section>

      {timeline.length > 0 && (
        <div className="timeline-scroll">
        <button className="timeline" onClick={onOpenCalendar} aria-label="Ближайшие поступления и платежи. Открыть календарь">
          <span className="tl-line" aria-hidden="true" />
          <span className="tl-pt now">
            <i />
            <b>Сегодня</b>
            <span className="d">{shortDate(today)}</span>
            {avail && <span className="v"><Money v={avail.total} whole /></span>}
          </span>
          {timeline.map(p => (
            <span className="tl-pt" key={p.key}>
              <i className={p.sum < 0 ? 'out' : 'in'} />
              <b>{p.label}</b>
              <span className="d">{shortDate(p.date)}</span>
              <span className={`v ${p.sum < 0 ? 'neg' : 'pos'}`}>{p.known ? <Money v={p.sum} sign whole /> : 'сумма не задана'}</span>
            </span>
          ))}
        </button>
        </div>
      )}

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

      <Section title={`Месяц: ${monthLabel(month).toLowerCase()}`} action="Аналитика" onAction={onOpenAnalytics} />
      <div className="tiles">
        <button className="tile" onClick={() => onOpenOps({ from: month, to: month })}>
          <span className="tile-ico in"><Icon name="income" size={18} stroke={2.2} /></span>
          <span className="k">Доходы</span>
          <span className="v"><Money v={totals.income} whole /></span>
          <span className="s">в {monthIn}</span>
        </button>
        <button className="tile" onClick={() => onOpenOps({ from: month, to: month })}>
          <span className="tile-ico out"><Icon name="expense" size={18} stroke={2.2} /></span>
          <span className="k">Расходы</span>
          <span className="v"><Money v={totals.expense} whole /></span>
          <span className="s">в {monthIn}</span>
        </button>
      </div>

      {splitTotal > 0 && (
        <>
          <Section title="Распределение средств" action="Счета" onAction={onOpenAccounts} />
          <div className="card split">
            <div className="split-bar" aria-hidden="true">
              {split.life > 0 && <i className="life" style={{ flexGrow: split.life }} />}
              {split.reserve > 0 && <i className="reserve" style={{ flexGrow: split.reserve }} />}
              {split.goals > 0 && <i className="goals" style={{ flexGrow: split.goals }} />}
            </div>
            <div className="split-legend">
              <span><i className="life" />На жизнь<b><Money v={split.life} whole /></b><em>{pctOf(split.life)}%</em></span>
              <span><i className="reserve" />Резерв<b><Money v={split.reserve} whole /></b><em>{pctOf(split.reserve)}%</em></span>
              <span><i className="goals" />Цели<b><Money v={split.goals} whole /></b><em>{pctOf(split.goals)}%</em></span>
            </div>
          </div>
        </>
      )}

      {goals.length > 0 && (
        <>
          <Section title="Цели" action="Все" onAction={onOpenGoals} />
          <div className="list">
            {goals.map(p => <GoalRow key={p.goal.id} data={data} p={p} onOpen={onOpenGoals} />)}
          </div>
        </>
      )}

      {attention.length > 0 && (
        <>
          <Section title="Требуют внимания" action="Бюджет" onAction={onOpenBudget} />
          <div className="list">{attention.map(e => <CategoryRow key={e.category.id} e={e} categories={data.categories} onOpen={() => onOpenOps({ categoryId: e.category.id, from: month, to: month })} />)}</div>
        </>
      )}

      <Section title="Последние операции" action="Все" onAction={() => onOpenOps({})} />
      <div className="list">
        {recent.length === 0 && <Empty title="Операций пока нет">Нажми «+» внизу, чтобы записать первую.</Empty>}
        {recent.map(t => <TxRow key={t.id} data={data} t={t} onOpen={setTx} />)}
      </div>

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
