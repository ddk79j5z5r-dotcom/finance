import { useRef, useState } from 'react'
import { accountKind, balances, capitalByMonth, movements, spendByRoot, spendRub, spentByCategory } from '../domain/calc'
import { byOrder, withChildren } from '../domain/categories'
import { daysInMonth } from '../domain/insights'
import { formatMoney, monthLabel, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { inTotal } from '../domain/plan'
import { INCOME_LABEL, type Account, type Category, type Tx } from '../domain/types'
import { Empty, Money, Section, Segmented, useAmountsHidden } from './common'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from '../domain/ops'
import { PickSheet } from './History'
import { Badge, CatBadge, Icon, INCOME_ICON } from './icons'
import { categoryPath } from '../domain/ops'
import { useMonthSlide } from './nav'

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
    else expense += spendRub(t) // расход минус возвраты; переводы — только потеря на курсе
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
  const [tag, setTag] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [pick, setPick] = useState<'tag' | 'category' | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const slide = useMonthSlide(`${end}|${period}`)

  const span = SPAN[period]
  const from = shiftMonth(end, -(span - 1))
  const acc = accountId != null ? data.accounts.find(a => a.id === accountId) : undefined
  // Фильтр по счёту: доходы и расходы этого счёта; переводы влияют только на его остаток.
  const txs = acc ? data.txs.filter(t => t.accountId === acc.id || t.toAccountId === acc.id) : data.txs
  // Категория (с подкатегориями) и метка сужают доходы и расходы; движение денег и капитал — от них не зависят.
  const catIds = categoryId != null ? withChildren(data.categories, categoryId) : null
  const cat = data.categories.find(c => c.id === categoryId)
  const flowTxs = (acc ? txs.filter(t => t.accountId === acc.id) : txs)
    .filter(t => !tag || t.tags?.includes(tag))
    .filter(t => !catIds || (t.categoryId != null && catIds.includes(t.categoryId)))
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
  // Расходы по категориям; при выбранной основной категории — по её подкатегориям.
  const cats = cat && cat.parentId == null && (cat.kind ?? 'expense') === 'expense' ? bySub(data.categories, flowTxs, cat, from, end) : cat ? [] : spendByRoot(data.categories, flowTxs, from, end)
  const catTotal = cats.reduce((s, c) => s + c.rub, 0)
  const incomes = incomeByCategory(data.categories, flowTxs, from, end)
  const move = movements(data.accounts, acc ? txs : data.txs, from, end)
  const moveRows = ([['saved', 'В копилки и на вклады'], ['invested', 'На брокерские счета'], ['repaid', 'Погашено долгов и кредитов'], ['borrowed', 'Получено в кредит или в долг'], ['lent', 'Выдано в долг'], ['returned', 'Вернули долг мне']] as const).filter(([k]) => move[k] !== 0)
  const refundsIn = flowTxs.filter(t => t.type === 'refund' && monthOf(t.date) >= from && monthOf(t.date) <= end)
  const oldRefunds = refundsIn.filter(t => { const o = data.txs.find(x => x.id === t.refundOf); return o && monthOf(o.date) < from })
  const hasDebts = data.accounts.some(a => !a.archived && accountKind(a) === 'credit')

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
      <div className="scroll-row" style={{ marginBottom: "0.6rem" }}>
        <button className={acc ? 'chip on' : 'chip'} aria-pressed={!!acc} onClick={() => setPickAcc(true)}><span>{acc?.name ?? 'Все счета в балансе'}</span><Icon name="right" size={11} /></button>
        <button className={cat ? 'chip on' : 'chip'} aria-pressed={!!cat} onClick={() => setPick('category')}><span>{cat ? categoryPath(data.categories, cat.id) : 'Все категории'}</span><Icon name="right" size={11} /></button>
        {(data.settings.tags?.length || tag) && <button className={tag ? 'chip on' : 'chip'} aria-pressed={!!tag} onClick={() => setPick('tag')}><span>{tag ? `#${tag}` : 'Метка'}</span><Icon name="right" size={11} /></button>}
        {(acc || cat || tag) && <button className="chip clear" onClick={() => { setAccountId(null); setCategoryId(null); setTag(null) }}>Сбросить</button>}
      </div>

      <div ref={slide}>
      {!enoughHistory ? (
        <div className="list"><Empty title="Мало истории для этого периода">Операции есть с {monthLabel(first).toLowerCase()}. Выбери период покороче.</Empty></div>
      ) : (
        <>
          <div className="trio kpi">
            <button onClick={() => onOpenOps({ from, to: end, accountId: acc?.id, categoryId: cat?.id, tag: tag ?? undefined })}><span className="v pos"><Money v={cur.income} whole /></span><span className="k">Доходы</span></button>
            <button onClick={() => onOpenOps({ from, to: end, accountId: acc?.id, categoryId: cat?.id, tag: tag ?? undefined })}><span className="v neg"><Money v={cur.expense} whole /></span><span className="k">Расходы</span></button>
            <div><span className={`v ${cur.income - cur.expense < 0 ? 'neg' : ''}`}><Money v={cur.income - cur.expense} sign whole /></span><span className="k">Чистый результат</span></div>
          </div>

          <Section title={`${period === 'month' ? 'Последние' : 'По месяцам:'} ${bars.length} ${plural(bars.length, ['месяц', 'месяца', 'месяцев'])}, ₽`} />
          <div className="card">
            <PairBars bars={bars} selected={period === 'month' ? end : null} hidden={hidden}
              onPick={(b) => setTip(hidden ? `${monthLabel(b.m)}: суммы скрыты` : `${monthLabel(b.m)}: доходы ${formatMoney(b.income)}, расходы ${formatMoney(b.expense)}, разница ${b.income - b.expense < 0 ? '−' : '+'}${formatMoney(Math.abs(b.income - b.expense))}`)} />
            <div className="legend" style={{ margin: '0.3rem 0 0' }}>
              <span><i style={{ background: 'var(--c-income)' }} />доходы</span>
              <span><i style={{ background: 'var(--c-expense)' }} />расходы</span>
            </div>
            <div className="tip" aria-live="polite">{tip ?? 'Веди пальцем по столбикам — покажу суммы'}</div>
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
          {hasPrev && <p className="hint">{partial ? 'Месяц ещё идёт, поэтому сравниваем одинаковое число дней.' : 'Сравниваем целые периоды одинаковой длины.'} Переводы между своими счетами, кредиты и долги не учитываются.</p>}

          {(!cat || cats.length > 0) && <>
          <Section title={cat ? `«${cat.name}» по подкатегориям` : 'Расходы по категориям'} extra={catTotal ? <span className="small muted"><Money v={catTotal} /></span> : undefined} />
          <div className="list">
            {empty || cats.length === 0 ? <Empty title="Расходов нет">За {label.toLowerCase()} трат не записано.</Empty> : cats.slice(0, cat ? 50 : 12).map(c => (
              <button className="row" key={c.category.id ?? 'direct'} onClick={() => {
                // Основная категория с подкатегориями — сначала разбивка по ним, иначе — сразу операции.
                if (!cat && data.categories.some(x => x.parentId === c.category.id)) setCategoryId(c.category.id!)
                else onOpenOps({ categoryId: c.category.id ?? cat?.id, from, to: end, accountId: acc?.id, tag: tag ?? undefined })
              }}>
                <CatBadge categories={data.categories} c={c.category.id == null ? cat : c.category} size={30} />
                <span className="body">
                  <span className="title">{c.category.name}</span>
                  <span className="bar" style={{ display: 'block' }}><span className="fill" style={{ display: 'block', width: `${(c.rub / cats[0].rub) * 100}%`, background: 'var(--c-expense)' }} /></span>
                </span>
                <span className="amt"><Money v={c.rub} /><span className="sub">{Math.round((c.rub / catTotal) * 100)}%</span></span>
              </button>
            ))}
          </div>
          </>}
          {refundsIn.length > 0 && (
            <p className="hint">Возвраты покупок (<Money v={refundsIn.reduce((s, t) => s + t.rub, 0)} />) уменьшают расход категории в том месяце, когда деньги вернулись.{oldRefunds.length > 0 && <> Из них <Money v={oldRefunds.reduce((s, t) => s + t.rub, 0)} /> — за покупки прошлых периодов: расход тех месяцев не меняется.</>}</p>
          )}

          {incomes.length > 0 && (
            <>
              <Section title="Доходы по категориям" />
              <div className="list">
                {incomes.map(x => (
                  <button className="row" key={x.key} onClick={() => onOpenOps(x.category ? { categoryId: x.category.id, from, to: end, accountId: acc?.id, tag: tag ?? undefined } : { incomeKind: x.kind, from, to: end, accountId: acc?.id })}>
                    {x.category ? <CatBadge categories={data.categories} c={x.category} size={30} /> : <Badge icon={INCOME_ICON[x.kind!]} tone="income" size={30} />}
                    <span className="body"><span className="title">{x.category?.name ?? INCOME_LABEL[x.kind!]}</span>{x.subs && <span className="sub">{x.subs}</span>}</span>
                    <span className="amt pos">+<Money v={x.rub} /><span className="sub">{Math.round((x.rub / cur.income) * 100)}%</span></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {moveRows.length > 0 && !cat && !tag && (
            <>
              <Section title="Движение денег" />
              <div className="list">
                {moveRows.map(([k, l]) => (
                  <div key={k} className="row noic" style={{ padding: '0.42rem 0.82rem' }}>
                    <span className="body title">{l}</span>
                    <span className="amt">{move[k] < 0 && '−'}<Money v={Math.abs(move[k])} /></span>
                  </div>
                ))}
              </div>
              <p className="hint">Переводы между своими счетами, кредиты и долги — не доходы и не расходы, поэтому показаны отдельно. Проценты по кредиту — расход в «Банковских расходах».</p>
            </>
          )}

          <Section title={acc ? `Остаток «${acc.name}» на конец месяца, ₽` : 'Капитал на конец месяца, ₽'} />
          <div className="card">
            <LineChart months={barMonths} values={capitalAll} hidden={hidden} onPick={(m, v) => setTip(hidden ? `${monthLabel(m)}: суммы скрыты` : `${monthLabel(m)}: ${formatMoney(v)}`)} />
            <p className="hint" style={{ marginBottom: 0 }}>
              {acc ? 'Деньги на счёте' : `Деньги на счетах в общем балансе (${counted.length} ${plural(counted.length, ['счёт', 'счёта', 'счетов'])})`}{data.bondPositions.length ? ', облигации — по рыночной цене за текущий месяц' : ''}. {hasDebts ? 'Кредиты вычтены — это чистый капитал.' : 'Кредитов нет, поэтому капитал равен активам.'}{counted.some(a => a.currency !== 'RUB') ? ` Валюта — ${rateHint(data.latestRate)}.` : ''}
            </p>
          </div>
        </>
      )}

      </div>

      {pick === 'tag' && (
        <PickSheet title="Метка" value={tag} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все' }, ...(data.settings.tags ?? []).map(t => ({ value: t, label: `#${t}` }))]}
          onPick={v => { setTag(v); setPick(null); setTip(null) }} />
      )}
      {pick === 'category' && (
        <PickSheet title="Категория" value={categoryId} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все категории' }, ...(['expense', 'income'] as const).flatMap(k => data.categories.filter(c => c.parentId == null && !c.system && !c.archived && (c.kind ?? 'expense') === k).sort(byOrder).flatMap(c => [
            { value: c.id!, label: k === 'income' ? `${c.name} (доход)` : c.name },
            ...data.categories.filter(x => x.parentId === c.id && !x.archived).sort(byOrder).map(x => ({ value: x.id!, label: `${c.name} · ${x.name}`, indent: true })),
          ]))]}
          onPick={v => { setCategoryId(v); setPick(null); setTip(null) }} />
      )}
      {pickAcc && (
        <PickSheet title="Счёт" value={accountId} onClose={() => setPickAcc(false)}
          options={[{ value: null, label: 'Все счета в балансе' }, ...activeAccounts(data.accounts).map(a => ({ value: a.id!, label: a.name }))]}
          onPick={v => { setAccountId(v); setPickAcc(false); setTip(null) }} />
      )}
    </div>
  )
}

/** Расход основной категории по подкатегориям за период; траты прямо в основной — строкой «Без подкатегории». */
function bySub(categories: Category[], txs: Tx[], root: Category, from: string, to: string): { category: Category; rub: number }[] {
  const sums = new Map<number, number>()
  for (let m = from; m <= to; m = shiftMonth(m, 1)) for (const [id, v] of spentByCategory(txs, m)) sums.set(id, (sums.get(id) ?? 0) + v)
  const rows = categories.filter(c => c.parentId === root.id).map(c => ({ category: c, rub: sums.get(c.id!) ?? 0 }))
  const direct = sums.get(root.id!) ?? 0
  if (direct) rows.push({ category: { ...root, id: undefined, name: 'Без подкатегории' }, rub: direct })
  return rows.filter(x => x.rub > 0).sort((a, b) => b.rub - a.rub)
}

/** Доходы по основным категориям (с подкатегориями внутри); доходы без категории — по старому виду. */
function incomeByCategory(categories: Category[], txs: Tx[], from: string, to: string) {
  const sums = new Map<string, { key: string; category?: Category; kind?: Tx['incomeKind']; rub: number; subs: Map<string, number> }>()
  for (const t of txs) {
    const m = monthOf(t.date)
    if (t.type !== 'income' || m < from || m > to) continue
    const c = categories.find(x => x.id === t.categoryId)
    const root = c?.parentId != null ? categories.find(x => x.id === c.parentId) : c
    const key = root ? `c${root.id}` : `k${t.incomeKind ?? 'other'}`
    const e = sums.get(key) ?? { key, category: root, kind: t.incomeKind ?? 'other', rub: 0, subs: new Map() }
    e.rub += t.rub
    if (c && c !== root) e.subs.set(c.name, (e.subs.get(c.name) ?? 0) + t.rub)
    sums.set(key, e)
  }
  return [...sums.values()].sort((a, b) => b.rub - a.rub)
    .map(e => ({ ...e, subs: e.subs.size ? [...e.subs].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3).join(', ') : '' }))
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
/** Доходы и расходы по месяцам: ось сумм с подписями; значение следует за пальцем, пока его ведёшь по столбикам. */
function PairBars({ bars, selected, hidden, onPick }: { bars: { m: string; income: number; expense: number }[]; selected: string | null; hidden: boolean; onPick: (b: { m: string; income: number; expense: number }) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const W = 330, H = 170, L = 44, B = 20, T = 8
  const max = Math.max(1, ...bars.flatMap(b => [b.income, b.expense]))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const y = (v: number) => T + (H - B - T) * (1 - v / top)
  const slot = (W - L) / bars.length
  const bw = Math.min(14, slot * 0.32)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    return Math.max(0, Math.min(bars.length - 1, Math.floor((x - L) / slot)))
  }
  const show = (i: number) => { if (i !== hover) { setHover(i); onPick(bars[i]) } }
  const h = hover != null ? bars[hover] : null
  const cx = (i: number) => L + i * slot + slot / 2
  return (
    <div className="chart-wrap">
      {h && hover != null && (
        <div className="bubble" style={{ left: `${(cx(hover) / W) * 100}%` }} aria-hidden="true">
          <b>{SHORT[mIdx(h.m)]}</b>{hidden ? ' · скрыто' : <> · <span className="pos">+{formatMoney(h.income)}</span> · <span className="neg">−{formatMoney(h.expense)}</span></>}
        </div>
      )}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={hidden ? 'Доходы и расходы по месяцам, суммы скрыты' : `Доходы и расходы по месяцам: ${bars.map(b => `${SHORT[mIdx(b.m)]} — доходы ${formatMoney(b.income)}, расходы ${formatMoney(b.expense)}`).join('; ')}`}
        onPointerDown={e => { dragging.current = true; show(at(e)) }}
        onPointerMove={e => { if (dragging.current) show(at(e)) }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}>
        {ticks.map(t => <g key={t}><line className="grid" x1={L} x2={W} y1={y(t)} y2={y(t)} /><text className="ytick" x={L - 5} y={y(t) + 3} textAnchor="end">{t ? kRub(t) : '0'}</text></g>)}
        {hover != null && <line className="cross" x1={cx(hover)} x2={cx(hover)} y1={T} y2={H - B} />}
        {bars.map((b, i) => {
          const on = hover != null ? i === hover : selected == null || b.m === selected
          return (
            <g key={b.m} style={{ cursor: 'pointer' }} opacity={on ? 1 : 0.45}>
              <rect x={L + i * slot} y={0} width={slot} height={H} fill="transparent" />
              <rect x={cx(i) - bw - 1} y={y(b.income)} width={bw} height={Math.max(0, H - B - y(b.income))} rx="2" fill="var(--c-income)" />
              <rect x={cx(i) + 1} y={y(b.expense)} width={bw} height={Math.max(0, H - B - y(b.expense))} rx="2" fill="var(--c-expense)" />
              <text x={cx(i)} y={H - 5} textAnchor="middle" className={i === hover || (hover == null && b.m === selected) ? 'val' : undefined}>{SHORT[mIdx(b.m)]}</text>
            </g>
          )
        })}
      </svg>
    </div>
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
