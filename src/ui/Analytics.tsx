import { useState, type PointerEvent, type ReactNode } from 'react'
import { capitalByMonth, incomeByKind, monthForecast, monthTotals, spendByRoot } from '../domain/calc'
import {
  averageCumulative, averageDailySpend, capitalMilestone, categoryDeltas, cumulativeSpend, daysInMonth, reserveDays, topCategories,
} from '../domain/insights'
import { formatMoney, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type Category } from '../domain/types'
import { AccountBadge } from './AccountBadge'
import { Money, useAmountsHidden } from './common'
import { activeAccounts, type Data } from './data'
import type { OpsFilter } from './History'
import { Badge, categoryIcon, Icon, INCOME_ICON } from './icons'

export type AnalyticsView = 'overview' | 'capital' | 'remainder' | 'pace'

const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const mi = (month: string) => Number(month.slice(5)) - 1

/** Всё, что нужно экранам аналитики, — считается один раз. */
function useInsights(data: Data) {
  const today = todayISO()
  const month = monthOf(today)
  const day = Number(today.slice(8))
  const days = daysInMonth(month)

  const accounts = activeAccounts(data.accounts)
  const capital = accounts.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5))
  const history = capitalByMonth(data.accounts, data.txs, months, (v, a) => data.toRub(v, a.currency) ?? 0)
  history[history.length - 1] = capital
  const totals = monthTotals(data.txs, month)
  const forecast = monthForecast(data, data.settings, today, r => data.toRub(r.amount, r.currency) ?? r.amount)
  const capitalEnd = capital + (forecast.income - totals.income) - (forecast.expense - totals.expense)

  const daily = averageDailySpend(data.txs, today)
  const spent = cumulativeSpend(data.txs, month)
  const avg = averageCumulative(data.txs, month)
  const paceDiff = avg ? spent[day - 1] - avg[day - 1] : null

  return {
    today, month, day, days, accounts, capital, months, history, capitalEnd, daily,
    reserve: reserveDays(capital, daily),
    milestone: capitalMilestone(capital, history.slice(0, -1)),
    spent, avg, paceDiff,
    deltas: categoryDeltas(data.categories, data.txs, month, day),
  }
}
type Insights = ReturnType<typeof useInsights>

export function Analytics({ data, initialView = 'overview', onBack, onOpenOps }: {
  data: Data; initialView?: AnalyticsView; onBack: () => void; onOpenOps: (f: OpsFilter) => void
}) {
  const [view, setView] = useState<AnalyticsView>(initialView)
  const ins = useInsights(data)
  const back = view === 'overview' || initialView !== 'overview'
    ? <button className="back" onClick={onBack}><Icon name="left" size={20} /> {initialView === 'overview' ? 'Ещё' : 'Главная'}</button>
    : <button className="back" onClick={() => setView('overview')}><Icon name="left" size={20} /> Аналитика</button>

  return (
    <div className="page an">
      {back}
      {view === 'overview' && <Overview data={data} ins={ins} open={setView} onOpenOps={onOpenOps} />}
      {view === 'capital' && <CapitalView data={data} ins={ins} />}
      {view === 'remainder' && <RemainderView data={data} ins={ins} onOpenOps={onOpenOps} />}
      {view === 'pace' && <PaceView data={data} ins={ins} onOpenOps={onOpenOps} />}
    </div>
  )
}

// ---------- Обзор ----------

function paceWord(diff: number | null) {
  if (diff == null) return 'Мало данных'
  return diff > 0 ? 'Выше среднего' : diff < 0 ? 'Ниже среднего' : 'Как обычно'
}

function Overview({ data, ins, open, onOpenOps }: { data: Data; ins: Insights; open: (v: AnalyticsView) => void; onOpenOps: (f: OpsFilter) => void }) {
  const { month, day } = ins
  const pairs = ins.months.slice(-4).map(m => ({ month: m, ...monthTotals(data.txs, m) }))
  const cur = pairs.at(-1)!
  const change = ins.deltas.filter(d => d.avg > 0 && Math.abs(d.diff) >= 50000)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0]
  const often = topCategories(data.categories, data.txs, month, day, 'count')
  const most = topCategories(data.categories, data.txs, month, day, 'sum')

  return (
    <>
      <h1>Аналитика</h1>
      <button className="an-tile" onClick={() => open('capital')}>
        <span className="t"><span className="v"><Money v={ins.capital} /></span><span className="k">Денег всего</span></span>
        <MiniLine values={[...ins.history, ins.capitalEnd]} />
      </button>
      <button className="an-tile" onClick={() => open('remainder')}>
        <span className="t"><span className="v"><Money v={cur.income - cur.expense} /></span><span className="k">Остаток от дохода</span></span>
        <MiniBars pairs={pairs} />
      </button>
      <button className="an-tile" onClick={() => open('pace')}>
        <span className="t"><span className="v small">{paceWord(ins.paceDiff)}</span><span className="k">Траты к этому дню</span></span>
        <MiniPace spent={ins.spent.slice(0, day)} avg={ins.avg} />
      </button>

      <h2 className="an-h">Как проходит {MONTHS_NOM[mi(month)]}</h2>

      {ins.paceDiff != null && ins.avg && (
        <button className="an-card" onClick={() => open('pace')}>
          <h3>{ins.paceDiff === 0 ? 'Тратите как обычно' : <>Тратите на <Money v={Math.abs(ins.paceDiff)} /> {ins.paceDiff > 0 ? 'больше' : 'меньше'}, чем обычно</>}</h3>
          <p className="an-sub">Сравнение со средним за прошлые месяцы к этому же дню</p>
          <PaceChart spent={ins.spent} avg={ins.avg} day={day} days={ins.days} />
        </button>
      )}

      {change && (
        <button className="an-card" onClick={() => onOpenOps({ categoryId: change.category.id, from: month, to: month })}>
          <h3>Траты в категории «{change.category.name}» {change.diff > 0 ? 'выросли' : 'снизились'} на <Money v={Math.abs(change.diff)} /></h3>
          <CompareBars now={change.now} avg={change.avg} day={day} month={month} />
        </button>
      )}

      {ins.milestone != null && (
        <button className="an-card" onClick={() => open('capital')}>
          <h3>Покорили новую финансовую высоту</h3>
          {ins.reserve != null && (
            <p className="an-sub">Этих денег хватит на {ins.reserve} {plural(ins.reserve, ['день', 'дня', 'дней'])} при ваших средних тратах <Money v={ins.daily} /> в день</p>
          )}
          <div className="an-milestone"><Icon name="star" size={16} /> <Money v={ins.milestone} /></div>
          <AreaLine values={[...ins.history, ins.capitalEnd]} labels={[]} compact />
        </button>
      )}

      {often.length >= 2 && (
        <div className="an-card">
          <h3>Чаще всего тратите здесь</h3>
          <p className="an-sub">К {day} {MONTHS_GEN[mi(month)]}</p>
          <Podium items={often.map(x => ({ category: x.category, value: x.count, label: `${x.count} ${plural(x.count, ['раз', 'раза', 'раз'])}` }))} />
        </div>
      )}
      {most.length >= 2 && (
        <div className="an-card">
          <h3>Больше всего тратите здесь</h3>
          <p className="an-sub">К {day} {MONTHS_GEN[mi(month)]}</p>
          <Podium items={most.map(x => ({ category: x.category, value: x.rub, label: <Money v={x.rub} /> }))} />
        </div>
      )}
      {data.txs.length === 0 && <p className="hint">Добавь операции — здесь появится аналитика.</p>}
    </>
  )
}

// ---------- Денег всего ----------

function CapitalView({ data, ins }: { data: Data; ins: Insights }) {
  const labels = ins.months.map(m => MONTHS_SHORT[mi(m)])
  return (
    <>
      <div className="an-hero">
        <div className="k">Денег всего</div>
        <div className="big"><Money v={ins.capital} /></div>
        {ins.reserve != null && <span className="an-pill">Запас на {ins.reserve} {plural(ins.reserve, ['день', 'дня', 'дней'])}</span>}
      </div>
      <AreaLine values={[...ins.history, ins.capitalEnd]} labels={labels} />
      <p className="an-note">Пунктир — прогноз на конец месяца: <Money v={ins.capitalEnd} /></p>
      <div className="an-card">
        <h3>Ваши деньги</h3>
        {ins.accounts.map(a => (
          <div className="row" key={a.id}>
            <AccountBadge account={a} color={data.colorOf(a)} size={40} />
            <div className="body">
              <div className="title num"><Money v={data.value.get(a.id!) ?? 0} cur={a.currency} /></div>
              <div className="sub">{a.name}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------- Остаток от дохода ----------

function RemainderView({ data, ins, onOpenOps }: { data: Data; ins: Insights; onOpenOps: (f: OpsFilter) => void }) {
  const [month, setMonth] = useState(ins.month)
  const pairs = ins.months.map(m => ({ month: m, ...monthTotals(data.txs, m) }))
  const sel = pairs.find(p => p.month === month) ?? pairs.at(-1)!
  const rest = sel.income - sel.expense
  const top = spendByRoot(data.categories, data.txs, month, month).slice(0, 8)
  const incomes = incomeByKind(data.txs, month, month)
  return (
    <>
      <div className="an-hero">
        <div className="k">Остаток от дохода</div>
        <div className="big"><Money v={rest} /></div>
        {sel.income > 0 && <span className="an-pill">{Math.round((rest / sel.income) * 100)}% от дохода</span>}
      </div>
      <PairBars pairs={pairs} selected={month} onSelect={setMonth} />
      <div className="an-legend">
        <span><i style={{ background: 'var(--c-spend)' }} />траты</span>
        <span><i style={{ background: 'var(--c-income)' }} />доходы</span>
      </div>
      <div className="an-duo">
        <div className="an-mini"><span className="v" style={{ color: 'var(--c-spend-text)' }}><Money v={sel.expense} /></span><span className="k">Траты</span></div>
        <div className="an-mini"><span className="v" style={{ color: 'var(--c-income-text)' }}><Money v={sel.income} /></span><span className="k">Доходы</span></div>
      </div>
      {top.length > 0 && (
        <div className="an-card">
          <h3>Топ трат в {MONTHS_PREP[mi(month)]}</h3>
          {top.map(x => (
            <button className="row" key={x.category.id} onClick={() => onOpenOps({ categoryId: x.category.id, from: month, to: month })}>
              <Badge icon={categoryIcon(x.category)} size={40} />
              <div className="body title">{x.category.name}</div>
              <div className="amt"><Money v={x.rub} /></div>
            </button>
          ))}
        </div>
      )}
      {incomes.length > 0 && (
        <div className="an-card">
          <h3>Доходы в {MONTHS_PREP[mi(month)]}</h3>
          {incomes.map(x => (
            <button className="row" key={x.kind} onClick={() => onOpenOps({ incomeKind: x.kind, from: month, to: month })}>
              <Badge icon={INCOME_ICON[x.kind]} tone="income" size={40} />
              <div className="body title">{INCOME_LABEL[x.kind]}</div>
              <div className="amt"><Money v={x.rub} /></div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ---------- Траты к этому дню ----------

function PaceView({ data, ins, onOpenOps }: { data: Data; ins: Insights; onOpenOps: (f: OpsFilter) => void }) {
  const { month, day, avg, paceDiff } = ins
  const up = ins.deltas.filter(d => d.diff > 0 && d.avg >= 0)
  const down = ins.deltas.filter(d => d.diff < 0).reverse()
  const row = (d: (typeof ins.deltas)[number]) => (
    <button className="row" key={d.category.id} onClick={() => onOpenOps({ categoryId: d.category.id, from: month, to: month })}>
      <Badge icon={categoryIcon(d.category)} size={40} />
      <div className="body">
        <div className="title">{d.category.name}</div>
        <div className="sub">В среднем <Money v={d.avg} /></div>
      </div>
      <div className="amt">
        <Money v={d.now} />
        <div><span className={`an-delta ${d.diff > 0 ? 'up' : 'down'}`}>{d.diff > 0 ? '↑' : '↓'} <Money v={Math.abs(d.diff)} /></span></div>
      </div>
    </button>
  )
  return (
    <>
      <div className="an-hero">
        <div className="k">{paceDiff == null ? 'Траты в этом месяце' : paceDiff >= 0 ? 'Траты выше среднего' : 'Траты ниже среднего'}</div>
        <div className="big">{paceDiff == null ? <Money v={ins.spent[day - 1]} /> : <>на <Money v={Math.abs(paceDiff)} /></>}</div>
      </div>
      <PaceChart spent={ins.spent} avg={avg} day={day} days={ins.days} interactive />
      <div className="an-duo">
        <div className="an-mini"><span className="v" style={{ color: 'var(--c-pace-text)' }}><Money v={ins.spent[day - 1]} /></span><span className="k">Траты к {day} {MONTHS_GEN[mi(month)]}</span></div>
        <div className="an-mini"><span className="v">{avg ? <Money v={avg[day - 1]} /> : '—'}</span><span className="k">Средние траты к этому дню</span></div>
      </div>
      {!avg && <p className="hint">Сравнение появится, когда накопится хотя бы месяц трат.</p>}
      {avg && up.length > 0 && <div className="an-card"><h3>Здесь траты выше среднего</h3>{up.slice(0, 8).map(row)}</div>}
      {avg && down.length > 0 && <div className="an-card"><h3>Здесь — ниже</h3>{down.slice(0, 8).map(row)}</div>}
      {data.txs.length === 0 && <p className="hint">Пока нет операций.</p>}
    </>
  )
}

// ---------- Графики ----------

/** Плавная линия через точки (монотонная кривая — без выбросов за значения). */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
    const mx = (x0 + x1) / 2
    d += `C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
  }
  return d
}

function scale(values: number[], top: number, bottom: number) {
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || Math.abs(max) || 1
  return (v: number) => bottom - ((v - min) / span) * (bottom - top)
}

/** Капитал по месяцам: последняя точка — прогноз на конец месяца (пунктиром). */
function AreaLine({ values, labels, compact = false }: { values: number[]; labels: string[]; compact?: boolean }) {
  const hidden = useAmountsHidden()
  const [sel, setSel] = useState<number | null>(null)
  const W = 340, H = compact ? 120 : 190, top = 16, bottom = H - (labels.length ? 28 : 8)
  const n = values.length
  const x = (i: number) => (i * W) / (n - 1)
  const y = scale(values, top, bottom)
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number])
  const solid = pts.slice(0, -1)
  const last = solid.at(-1)!
  const shown = sel ?? n - 2
  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Деньги по месяцам">
      <defs>
        <linearGradient id="capFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--c-capital)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--c-capital)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${smoothPath(solid)}L${last[0]},${bottom}L0,${bottom}Z`} fill="url(#capFill)" />
      <path d={smoothPath(solid)} fill="none" stroke="var(--c-capital)" strokeWidth="2.5" strokeLinecap="round" />
      <path d={`M${last[0]},${last[1]}L${pts[n - 1][0]},${pts[n - 1][1]}`} fill="none" stroke="var(--c-capital)" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
      {!compact && <line x1={pts[shown][0]} x2={pts[shown][0]} y1={top - 6} y2={bottom} className="an-cross" />}
      <circle cx={pts[shown][0]} cy={pts[shown][1]} r="7" fill="var(--card)" stroke="var(--c-capital)" strokeWidth="3" />
      {!compact && !hidden && (
        <text className="an-val" x={Math.min(W - 44, Math.max(44, pts[shown][0]))} y={Math.max(12, pts[shown][1] - 14)} textAnchor="middle">
          {formatMoney(values[shown])}
        </text>
      )}
      {labels.map((l, i) => (
        <g key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
          <rect x={x(i) - W / n / 2} y={0} width={W / n} height={H} fill="transparent" />
          <text x={Math.min(W - 14, Math.max(14, x(i)))} y={H - 6} textAnchor="middle" className={i === shown ? 'an-axis on' : 'an-axis'}>{l}</text>
        </g>
      ))}
    </svg>
  )
}

/** Траты нарастающим итогом: этот месяц до сегодня — сплошная, среднее за весь месяц — пунктир. */
function PaceChart({ spent, avg, day, days, interactive = false }: { spent: number[]; avg: number[] | null; day: number; days: number; interactive?: boolean }) {
  const hidden = useAmountsHidden()
  const [hover, setHover] = useState<number | null>(null)
  const W = 340, H = 170, top = 14, bottom = H - 26
  const x = (d: number) => ((d - 1) * W) / Math.max(1, days - 1)
  const all = [...spent.slice(0, day), ...(avg ?? []), 0]
  const y = scale(all, top, bottom)
  const now = spent.slice(0, day).map((v, i) => [x(i + 1), y(v)] as [number, number])
  const avgPts = avg?.map((v, i) => [x(i + 1), y(v)] as [number, number])
  const end = now.at(-1) ?? [0, bottom]
  const h = hover ?? day
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.min(days, Math.max(1, Math.round(((e.clientX - r.left) / r.width) * (days - 1)) + 1)))
  }
  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Траты по дням месяца и в среднем"
      onPointerMove={interactive ? move : undefined} onPointerDown={interactive ? move : undefined} onPointerLeave={interactive ? () => setHover(null) : undefined}>
      <defs>
        <linearGradient id="paceFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--c-pace)" stopOpacity="0.25" />
          <stop offset="1" stopColor="var(--c-pace)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {avgPts && <path d={smoothPath(avgPts)} fill="none" stroke="var(--c-avg)" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />}
      {now.length > 1 && <path d={`${smoothPath(now)}L${end[0]},${bottom}L0,${bottom}Z`} fill="url(#paceFill)" />}
      {now.length > 1 && <path d={smoothPath(now)} fill="none" stroke="var(--c-pace)" strokeWidth="2.5" strokeLinecap="round" />}
      <circle cx={end[0]} cy={end[1]} r="7" fill="var(--card)" stroke="var(--c-pace)" strokeWidth="3" />
      {interactive && hover != null && (
        <>
          <line x1={x(h)} x2={x(h)} y1={top} y2={bottom} className="an-cross" />
          {!hidden && (
            <text className="an-val" x={Math.min(W - 70, Math.max(70, x(h)))} y={11} textAnchor="middle">
              {h <= day ? `${h}-е: ${formatMoney(spent[h - 1])}` : `${h}-е`}{avg ? ` · ср. ${formatMoney(avg[h - 1])}` : ''}
            </text>
          )}
        </>
      )}
      <text x={6} y={H - 6} className="an-axis">1</text>
      <text x={Math.min(W - 40, Math.max(30, x(day)))} y={H - 6} textAnchor="middle" className="an-axis on">{day}</text>
      <text x={W - 4} y={H - 6} textAnchor="end" className="an-axis">{days}</text>
    </svg>
  )
}

/** Доходы и траты по месяцам: пара столбцов, выбранный месяц — ярко. */
function PairBars({ pairs, selected, onSelect }: { pairs: { month: string; income: number; expense: number }[]; selected: string; onSelect: (m: string) => void }) {
  const hidden = useAmountsHidden()
  const W = 340, H = 200, bottom = H - 28, top = 8
  const max = Math.max(1, ...pairs.flatMap(p => [p.income, p.expense]))
  const slot = W / pairs.length
  const bw = Math.min(22, slot * 0.3)
  const h = (v: number) => Math.max(v > 0 ? 4 : 0, ((bottom - top) * v) / max)
  return (
    <svg className="an-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Траты и доходы по месяцам">
      {pairs.map((p, i) => {
        const cx = i * slot + slot / 2
        const on = p.month === selected
        const he = h(p.expense), hi = h(p.income)
        return (
          <g key={p.month} onClick={() => onSelect(p.month)} style={{ cursor: 'pointer' }} opacity={on ? 1 : 0.35}>
            <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
            <rect x={cx - bw - 1} y={bottom - he} width={bw} height={he} rx="5" fill="var(--c-spend)" />
            <rect x={cx + 1} y={bottom - hi} width={bw} height={hi} rx="5" fill="var(--c-income)" />
            <text x={cx} y={H - 6} textAnchor="middle" className={on ? 'an-axis on' : 'an-axis'}>{MONTHS_SHORT[mi(p.month)]}</text>
            <title>{`${MONTHS_NOM[mi(p.month)]}: траты ${hidden ? '••••' : formatMoney(p.expense)}, доходы ${hidden ? '••••' : formatMoney(p.income)}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

/** Сейчас против среднего — две горизонтальные полосы. */
function CompareBars({ now, avg, day, month }: { now: number; avg: number; day: number; month: string }) {
  const max = Math.max(now, avg, 1)
  return (
    <div className="an-compare">
      <div className="l"><strong><Money v={now} /></strong> <span>на {day} {MONTHS_GEN[mi(month)]}</span></div>
      <div className="track"><div className="fill now" style={{ width: `${Math.max(4, (now / max) * 100)}%` }} /></div>
      <div className="l"><strong><Money v={avg} /></strong> <span>в среднем к этому дню</span></div>
      <div className="track"><div className="fill avg" style={{ width: `${Math.max(4, (avg / max) * 100)}%` }} /></div>
    </div>
  )
}

/** Пьедестал из трёх столбцов: чем больше значение, тем выше. По возрастанию слева направо. */
function Podium({ items }: { items: { category: Category; value: number; label: ReactNode }[] }) {
  const sorted = [...items].sort((a, b) => a.value - b.value)
  const max = Math.max(1, ...sorted.map(i => i.value))
  return (
    <div className="an-podium">
      {sorted.map(i => (
        <div className="col" key={i.category.id}>
          <div className="bar" style={{ height: 80 + (i.value / max) * 110 }}>
            <Badge icon={categoryIcon(i.category)} size={44} />
            <span className="v">{i.label}</span>
          </div>
          <span className="n">{i.category.name}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Миниатюры для плиток ----------

function MiniLine({ values }: { values: number[] }) {
  const W = 110, H = 50
  const y = scale(values, 8, H - 8)
  const pts = values.map((v, i) => [(i * (W - 10)) / (values.length - 1), y(v)] as [number, number])
  const last = pts.at(-2)!
  return (
    <svg className="an-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={smoothPath(pts.slice(0, -1))} fill="none" stroke="var(--c-capital)" strokeWidth="2.5" strokeLinecap="round" />
      <path d={`M${last[0]},${last[1]}L${pts.at(-1)![0]},${pts.at(-1)![1]}`} stroke="var(--c-capital)" strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="var(--c-capital)" />
    </svg>
  )
}

function MiniBars({ pairs }: { pairs: { income: number; expense: number }[] }) {
  const W = 110, H = 50
  const max = Math.max(1, ...pairs.flatMap(p => [p.income, p.expense]))
  const slot = W / pairs.length
  return (
    <svg className="an-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {pairs.map((p, i) => {
        const last = i === pairs.length - 1
        const he = Math.max(3, (p.expense / max) * (H - 4)), hi = Math.max(3, (p.income / max) * (H - 4))
        return (
          <g key={i}>
            <rect x={i * slot + slot / 2 - 9} y={H - he} width="8" height={he} rx="3" fill={last ? 'var(--c-spend)' : 'var(--fill-strong)'} />
            <rect x={i * slot + slot / 2 + 1} y={H - hi} width="8" height={hi} rx="3" fill={last ? 'var(--c-income)' : 'var(--fill-strong)'} />
          </g>
        )
      })}
    </svg>
  )
}

function MiniPace({ spent, avg }: { spent: number[]; avg: number[] | null }) {
  const W = 110, H = 50
  const days = avg?.length ?? Math.max(spent.length, 2)
  const y = scale([...spent, ...(avg ?? []), 0], 6, H - 6)
  const x = (i: number) => (i * W) / Math.max(1, days - 1)
  const now = spent.map((v, i) => [x(i), y(v)] as [number, number])
  const end = now.at(-1)
  return (
    <svg className="an-thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {avg && <path d={smoothPath(avg.map((v, i) => [x(i), y(v)]))} fill="none" stroke="var(--c-avg)" strokeWidth="2.5" strokeDasharray="4 4" />}
      {now.length > 1 && <path d={smoothPath(now)} fill="none" stroke="var(--c-pace)" strokeWidth="2.5" strokeLinecap="round" />}
      {end && <circle cx={end[0]} cy={end[1]} r="5" fill="var(--c-pace)" />}
    </svg>
  )
}
