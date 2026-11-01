import { useState } from 'react'
import { balances, capitalByMonth, fxLoss, incomeByKind, spendByRoot } from '../domain/calc'
import { daysInMonth } from '../domain/insights'
import { formatMoney, monthLabel, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { inTotal } from '../domain/plan'
import { INCOME_LABEL, type Account, type Tx } from '../domain/types'
import { Empty, Money, Section, Segmented, useAmountsHidden } from './common'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from './History'
import { PickSheet } from './History'
import { Badge, categoryIcon, Icon, INCOME_ICON } from './icons'

type Period = 'month' | 'quarter' | 'year'
const SPAN: Record<Period, number> = { month: 1, quarter: 3, year: 12 }
const SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const mIdx = (m: string) => Number(m.slice(5)) - 1

/** Доходы и расходы операций, попавших в фильтр (переводы между своими счетами — не доход и не расход). */
function totalsOf(txs: Tx[], from: string, to: string, dayLimit?: number) {
  let income = 0, expense = 0
  for (const t of txs) {
    const m = monthOf(t.date)
    if (m < from || m > to) continue
    if (dayLimit != null && Number(t.date.slice(8)) > dayLimit) continue
    if (t.type === 'income') income += t.rub
    else if (t.type === 'expense') expense += t.rub
    else expense += fxLoss(t)
  }
  return { income, expense }
}

/** Красивый шаг шкалы: 1, 2 или 5 × 10ⁿ. */
function niceStep(max: number, ticks = 4) {
  const raw = max / ticks
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  return [1, 2, 5, 10].map(k => k * p).find(s => s >= raw) ?? raw
}
const kRub = (minor: number) => {
  const rub = minor / 100
  return Math.abs(rub) >= 1_000_000 ? `${(rub / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн` : `${Math.round(rub / 1000).toLocaleString('ru-RU')} тыс`
}

export function Analytics({ data, onOpenOps }: { data: Data; onOpenOps: (f: OpsFilter) => void }) {
  const hidden = useAmountsHidden()
  const thisMonth = monthOf(todayISO())
  const [period, setPeriod] = useState<Period>('month')
  const [end, setEnd] = useState(thisMonth)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [pickAcc, setPickAcc] = useState(false)
  const [tip, setTip] = useState<string | null>(null)

  const span = SPAN[period]
  const from = shiftMonth(end, -(span - 1))
  const acc = accountId != null ? data.accounts.find(a => a.id === accountId) : undefined
  // Фильтр по счёту: доходы и расходы этого счёта; переводы влияют только на его остаток.
  const txs = acc ? data.txs.filter(t => t.accountId === acc.id || t.toAccountId === acc.id) : data.txs
  const flowTxs = acc ? txs.filter(t => t.accountId === acc.id) : txs
  const first = data.txs[0]?.date ? monthOf(data.txs[0].date) : thisMonth
  const label = period === 'month' ? monthLabel(end) : `${monthLabel(from)} — ${monthLabel(end)}`
  const enoughHistory = from >= first || period === 'month'
  const cur = totalsOf(flowTxs, from, end)

  // Сравнение с предыдущим сопоставимым периодом. Текущий месяц ещё идёт — сравниваем с тем же числом прошлого месяца.
  const prevEnd = shiftMonth(end, -span), prevFrom = shiftMonth(from, -span)
  const partial = period === 'month' && end === thisMonth
  const day = Number(todayISO().slice(8))
  const curCmp = partial ? totalsOf(flowTxs, from, end, day) : cur
  const prevCmp = totalsOf(flowTxs, prevFrom, prevEnd, partial ? Math.min(day, daysInMonth(prevEnd)) : undefined)
  const hasPrev = prevFrom >= first && (prevCmp.income > 0 || prevCmp.expense > 0)
  const base = partial ? `с 1 по ${day} ${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][mIdx(prevEnd)]}` : period === 'month' ? monthLabel(prevEnd) : `${monthLabel(prevFrom)} — ${monthLabel(prevEnd)}`
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)

  // Столбики по месяцам: для месяца — 6 последних, для квартала и года — месяцы периода.
  const barMonths = Array.from({ length: Math.max(span, period === 'month' ? 6 : span) }, (_, i) => shiftMonth(end, i - Math.max(span, period === 'month' ? 6 : span) + 1))
  const bars = barMonths.map(m => ({ m, ...totalsOf(flowTxs, m, m) }))
  const cats = spendByRoot(data.categories, acc ? flowTxs : data.txs, from, end)
  const catTotal = cats.reduce((s, c) => s + c.rub, 0)
  const incomes = incomeByKind(flowTxs, from, end)

  // Капитал (или остаток счёта) на конец месяцев; облигации — по рыночной цене только на сегодня.
  const counted = acc ? [acc] : activeAccounts(data.accounts).filter(inTotal)
  const toRub = (v: number, a: Account) => data.toRub(v, a.currency) ?? 0
  const capital = barMonths.map(m => {
    const last = `${m}-${String(daysInMonth(m)).padStart(2, '0')}`
    if (acc) return toRub(balances([acc], data.txs.filter(t => t.date <= last), data.trades.filter(t => t.date <= last)).get(acc.id!) ?? 0, acc) + (m >= thisMonth ? toRub(data.bondValue.get(acc.id!) ?? 0, acc) : 0)
    return 0
  })
  const capitalAll = acc ? capital : capitalByMonth(counted, data.txs.filter(t => counted.some(a => a.id === t.accountId || a.id === t.toAccountId)), barMonths, toRub)
    .map((v, i) => (barMonths[i] >= thisMonth ? v + counted.reduce((s, a) => s + toRub(data.bondValue.get(a.id!) ?? 0, a) - (data.bondPositions.filter(p => p.accountId === a.id).reduce((x, p) => x + p.invested, 0)), 0) : v))

  const empty = cur.income === 0 && cur.expense === 0

  return (
    <div className="page">
      <div className="page-head"><h1>Аналитика</h1></div>
      <Segmented value={period} onChange={p => { setPeriod(p); setTip(null) }} options={[{ value: 'month', label: 'Месяц' }, { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Год' }]} />
      <div className="month-nav">
        <button className="icon-btn" aria-label="Предыдущий период" onClick={() => { setEnd(e => shiftMonth(e, -span)); setTip(null) }}><Icon name="left" /></button>
        <strong>{label}</strong>
        <button className="icon-btn" aria-label="Следующий период" disabled={end >= thisMonth} style={{ opacity: end >= thisMonth ? 0.3 : 1 }} onClick={() => { setEnd(e => shiftMonth(e, span)); setTip(null) }}><Icon name="right" /></button>
      </div>
      <div className="chips" style={{ marginBottom: '0.6rem' }}>
        <button className={acc ? 'chip on' : 'chip'} aria-pressed={!!acc} onClick={() => setPickAcc(true)}><span>{acc?.name ?? 'Все счета в балансе'}</span><Icon name="right" size={11} /></button>
        {acc && <button className="chip clear" onClick={() => setAccountId(null)}>Сбросить</button>}
      </div>

      {!enoughHistory ? (
        <div className="list"><Empty title="Мало истории для этого периода">Операции есть с {monthLabel(first).toLowerCase()}. Выбери период покороче.</Empty></div>
      ) : (
        <>
          <div className="trio">
            <button onClick={() => onOpenOps({ from, to: end, accountId: acc?.id })}><span className="k">Доходы</span><span className="v pos"><Money v={cur.income} sign /></span></button>
            <button onClick={() => onOpenOps({ from, to: end, accountId: acc?.id })}><span className="k">Расходы</span><span className="v">{cur.expense ? '−' : ''}<Money v={cur.expense} /></span></button>
            <div><span className="k">Разница</span><span className={`v ${cur.income - cur.expense < 0 ? 'neg' : ''}`}><Money v={cur.income - cur.expense} sign /></span></div>
          </div>

          <Section title="Доходы и расходы, ₽" />
          <div className="card">
            <PairBars bars={bars} selected={period === 'month' ? end : null} hidden={hidden}
              onPick={(b) => setTip(hidden ? `${monthLabel(b.m)}: суммы скрыты` : `${monthLabel(b.m)}: доходы ${formatMoney(b.income)}, расходы ${formatMoney(b.expense)}, разница ${b.income - b.expense < 0 ? '−' : '+'}${formatMoney(Math.abs(b.income - b.expense))}`)} />
            <div className="legend" style={{ margin: '0.3rem 0 0' }}>
              <span><i style={{ background: 'var(--c-income)' }} />доходы</span>
              <span><i style={{ background: 'var(--c-expense)' }} />расходы</span>
            </div>
            <div className="tip" aria-live="polite">{tip ?? 'Нажми на месяц — покажу суммы'}</div>
          </div>

          <Section title={`Сравнение: ${base}`} />
          <div className="list">
            {hasPrev ? (
              <>
                <Cmp label="Расходы" now={curCmp.expense} before={prevCmp.expense} good="down" pct={pct(curCmp.expense, prevCmp.expense)} />
                <Cmp label="Доходы" now={curCmp.income} before={prevCmp.income} good="up" pct={pct(curCmp.income, prevCmp.income)} />
              </>
            ) : <Empty title="Не с чем сравнить">За предыдущий период ({base}) операций нет.</Empty>}
          </div>
          {hasPrev && <p className="hint">{partial ? 'Месяц ещё идёт, поэтому сравниваем одинаковое число дней.' : 'Сравниваем целые периоды одинаковой длины.'} Переводы между своими счетами не учитываются.</p>}

          <Section title="Расходы по категориям" extra={catTotal ? <span className="small muted"><Money v={catTotal} /></span> : undefined} />
          <div className="list">
            {empty || cats.length === 0 ? <Empty title="Расходов нет">За {label.toLowerCase()} трат не записано.</Empty> : cats.slice(0, 10).map(c => (
              <button className="row" key={c.category.id} onClick={() => onOpenOps({ categoryId: c.category.id, from, to: end, accountId: acc?.id })}>
                <Badge icon={categoryIcon(c.category)} size={30} />
                <span className="body">
                  <span className="title">{c.category.name}</span>
                  <span className="bar" style={{ display: 'block' }}><span className="fill" style={{ display: 'block', width: `${(c.rub / cats[0].rub) * 100}%`, background: 'var(--c-expense)' }} /></span>
                </span>
                <span className="amt"><Money v={c.rub} /><span className="sub">{Math.round((c.rub / catTotal) * 100)}%</span></span>
              </button>
            ))}
          </div>

          {incomes.length > 0 && (
            <>
              <Section title="Источники дохода" />
              <div className="list">
                {incomes.map(x => (
                  <button className="row" key={x.kind} onClick={() => onOpenOps({ incomeKind: x.kind, from, to: end, accountId: acc?.id })}>
                    <Badge icon={INCOME_ICON[x.kind]} tone="income" size={30} />
                    <span className="body title">{INCOME_LABEL[x.kind]}</span>
                    <span className="amt pos">+<Money v={x.rub} /><span className="sub">{Math.round((x.rub / cur.income) * 100)}%</span></span>
                  </button>
                ))}
              </div>
            </>
          )}

          <Section title={acc ? `Остаток «${acc.name}» на конец месяца, ₽` : 'Капитал на конец месяца, ₽'} />
          <div className="card">
            <LineChart months={barMonths} values={capitalAll} hidden={hidden} onPick={(m, v) => setTip(hidden ? `${monthLabel(m)}: суммы скрыты` : `${monthLabel(m)}: ${formatMoney(v)}`)} />
            <p className="hint" style={{ marginBottom: 0 }}>
              {acc ? 'Деньги на счёте' : `Деньги на счетах в общем балансе (${counted.length} ${plural(counted.length, ['счёт', 'счёта', 'счетов'])})`}{data.bondPositions.length ? ', облигации — по рыночной цене за текущий месяц' : ''}. Долгов в данных нет, поэтому капитал равен активам.{counted.some(a => a.currency !== 'RUB') ? ` Валюта — ${rateHint(data.latestRate)}.` : ''}
            </p>
          </div>
        </>
      )}

      {pickAcc && (
        <PickSheet title="Счёт" value={accountId} onClose={() => setPickAcc(false)}
          options={[{ value: null, label: 'Все счета в балансе' }, ...activeAccounts(data.accounts).map(a => ({ value: a.id!, label: a.name }))]}
          onPick={v => { setAccountId(v); setPickAcc(false); setTip(null) }} />
      )}
    </div>
  )
}

function Cmp({ label, now, before, pct, good }: { label: string; now: number; before: number; pct: number | null; good: 'up' | 'down' }) {
  const better = pct == null ? null : good === 'up' ? pct > 0 : pct < 0
  return (
    <div className="row noic" style={{ padding: '0.42rem 0.82rem' }}>
      <span className="body"><span className="title">{label}</span><span className="sub">было <Money v={before} /></span></span>
      <span className="amt"><Money v={now} />
        {pct != null && <span className={`sub ${pct === 0 ? '' : better ? 'pos' : 'neg'}`}>{pct > 0 ? '↑ +' : pct < 0 ? '↓ −' : ''}{Math.abs(pct)}%</span>}
      </span>
    </div>
  )
}

/** Доходы и расходы по месяцам: ось сумм с подписями, значение по нажатию на месяц. */
function PairBars({ bars, selected, hidden, onPick }: { bars: { m: string; income: number; expense: number }[]; selected: string | null; hidden: boolean; onPick: (b: { m: string; income: number; expense: number }) => void }) {
  const W = 330, H = 170, L = 44, B = 20, T = 8
  const max = Math.max(1, ...bars.flatMap(b => [b.income, b.expense]))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = (v: number) => T + (H - B - T) * (1 - v / top)
  const slot = (W - L) / bars.length
  const bw = Math.min(14, slot * 0.32)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={hidden ? 'Доходы и расходы по месяцам, суммы скрыты' : `Доходы и расходы по месяцам: ${bars.map(b => `${SHORT[mIdx(b.m)]} — доходы ${formatMoney(b.income)}, расходы ${formatMoney(b.expense)}`).join('; ')}`}>
      {ticks.map(t => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text className="ytick" x={L - 5} y={y(t) + 3} textAnchor="end">{t ? kRub(t) : '0'}</text></g>)}
      {bars.map((b, i) => {
        const cx = L + i * slot + slot / 2
        const on = selected == null || b.m === selected
        return (
          <g key={b.m} onClick={() => onPick(b)} style={{ cursor: 'pointer' }} opacity={on ? 1 : 0.45}>
            <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" />
            <rect x={cx - bw - 1} y={y(b.income)} width={bw} height={Math.max(0, H - B - y(b.income))} rx="2" fill="var(--c-income)" />
            <rect x={cx + 1} y={y(b.expense)} width={bw} height={Math.max(0, H - B - y(b.expense))} rx="2" fill="var(--c-expense)" />
            <text x={cx} y={H - 5} textAnchor="middle" className={b.m === selected ? 'val' : undefined}>{SHORT[mIdx(b.m)]}</text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ months, values, hidden, onPick }: { months: string[]; values: number[]; hidden: boolean; onPick: (m: string, v: number) => void }) {
  const W = 330, H = 130, L = 44, B = 20, T = 10
  const min = Math.min(0, ...values), max = Math.max(1, ...values)
  const step = niceStep(max - min, 3)
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step || step
  const y = (v: number) => T + (H - B - T) * (1 - (v - lo) / (hi - lo))
  const x = (i: number) => L + 8 + (i * (W - L - 16)) / Math.max(1, months.length - 1)
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={hidden ? 'Капитал по месяцам, суммы скрыты' : `Капитал по месяцам: ${months.map((m, i) => `${SHORT[mIdx(m)]} — ${formatMoney(values[i])}`).join('; ')}`}>
      {ticks.map(t => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text className="ytick" x={L - 5} y={y(t) + 3} textAnchor="end">{t ? kRub(t) : '0'}</text></g>)}
      <path d={d} fill="none" stroke="var(--c-capital)" strokeWidth="2" strokeLinejoin="round" />
      {months.map((m, i) => (
        <g key={m} onClick={() => onPick(m, values[i])} style={{ cursor: 'pointer' }}>
          <rect x={x(i) - (W - L) / months.length / 2} y={0} width={(W - L) / months.length} height={H} fill="transparent" />
          <circle cx={x(i)} cy={y(values[i])} r={i === months.length - 1 ? 4 : 2.5} fill="var(--c-capital)" />
          <text x={x(i)} y={H - 5} textAnchor="middle">{SHORT[mIdx(m)]}</text>
        </g>
      ))}
    </svg>
  )
}
