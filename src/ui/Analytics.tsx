import { useState, type ReactNode } from 'react'
import { capitalByMonth, incomeByKind, monthTotals, savingsRate, spendByRoot } from '../domain/calc'
import { formatMoney, monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type IncomeKind } from '../domain/types'
import { Money, MonthNav, Segmented, useAmountsHidden } from './common'
import type { Data } from './data'
import type { OpsFilter } from './History'

export type Mode = 'expense' | 'income'
type Period = 'month' | 'quarter' | 'year'
const PERIOD_MONTHS: Record<Period, number> = { month: 1, quarter: 3, year: 12 }
/** Категориальная палитра (проверена на различимость, в т.ч. при дальтонизме): 5 цветов + «Другое». */
const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)']
const OTHER = 'var(--s-other)'
const SHORT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

interface Slice { key: string; label: string; rub: number; color: string }

export function Analytics({ data, initialMode = 'expense', onOpenOps }: { data: Data; initialMode?: Mode; onOpenOps: (f: OpsFilter) => void }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(monthOf(todayISO()))
  const [active, setActive] = useState<string | null>(null)
  const hidden = useAmountsHidden()

  const from = shiftMonth(month, -(PERIOD_MONTHS[period] - 1))
  const raw = mode === 'expense'
    ? spendByRoot(data.categories, data.txs, from, month).map(x => ({ key: `c${x.category.id}`, label: x.category.name, rub: x.rub }))
    : incomeByKind(data.txs, from, month).map(x => ({ key: x.kind, label: INCOME_LABEL[x.kind], rub: x.rub }))
  // Больше пяти — остальное в «Другое», чтобы цвета оставались различимыми.
  const slices: Slice[] = raw.slice(0, raw.length > 6 ? 5 : 6).map((x, i) => ({ ...x, color: SLOTS[i] ?? OTHER }))
  if (raw.length > 6) slices.push({ key: 'other', label: 'Другое', rub: raw.slice(5).reduce((s, x) => s + x.rub, 0), color: OTHER })
  const total = slices.reduce((s, x) => s + x.rub, 0)
  const focus = slices.find(s => s.key === active)

  const barCount = period === 'year' ? 12 : 6

  const pairMonths = Array.from({ length: barCount }, (_, i) => shiftMonth(month, i - barCount + 1))
  const pairs = pairMonths.map(m => ({ month: m, ...monthTotals(data.txs, m) }))
  const sel = pairs.find(p => p.month === month)
  const capital = capitalByMonth(data.accounts, data.txs, pairMonths, (v, a) => data.toRub(v, a.currency) ?? 0)

  const periodLabel = period === 'month' ? monthLabel(month) : `${monthLabel(from)} — ${monthLabel(month)}`

  return (
    <div className="page">
      <div className="page-head"><h1>Аналитика</h1></div>
      <Segmented value={mode} onChange={v => { setMode(v); setActive(null) }} options={[{ value: 'expense', label: 'Расходы' }, { value: 'income', label: 'Доходы' }]} />
      <Segmented className="small" value={period} onChange={v => { setPeriod(v); setActive(null) }} options={[
        { value: 'month', label: 'Месяц' }, { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Год' },
      ]} />
      <MonthNav label={periodLabel} onPrev={() => setMonth(m => shiftMonth(m, -1))} onNext={() => setMonth(m => shiftMonth(m, 1))} />

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>{mode === 'expense' ? 'Структура расходов' : 'Источники дохода'}</h3>
        {total === 0 ? <p className="hint">За этот период операций нет.</p> : (
          <div className="donut-wrap">
            <Donut slices={slices} total={total} active={active} onSelect={k => setActive(a => (a === k ? null : k))}>
              <text x="80" y="76" textAnchor="middle" className="donut-center" fill="var(--text)">
                {hidden ? '••••' : compact(focus?.rub ?? total)}
              </text>
              <text x="80" y="96" textAnchor="middle" fontSize="11" fill="var(--muted)">
                {focus ? focus.label.slice(0, 18) : period === 'month' ? 'за месяц' : 'за период'}
              </text>
            </Donut>
            <div>
              {slices.map(s => (
                <button key={s.key} className="leg-row" style={{ width: '100%', opacity: active && active !== s.key ? 0.45 : 1 }}
                  onClick={() => setActive(a => (a === s.key ? null : s.key))}>
                  <i style={{ background: s.color }} />
                  <span className="n">{s.label}</span>
                  <span className="p">{Math.round((s.rub / total) * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="card tight">
          {slices.map(s => (
            <button className="row" key={s.key} onClick={() => onOpenOps({
              from, to: month,
              ...(s.key.startsWith('c') ? { categoryId: Number(s.key.slice(1)) } : s.key !== 'other' ? { incomeKind: s.key as IncomeKind } : {}),
            })}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: 'none' }} />
              <div className="body title">{s.label}</div>
              <div className="amt"><Money v={s.rub} round /><div className="sub">{Math.round((s.rub / total) * 100)}%</div></div>
            </button>
          ))}
        </div>
      )}

      <div className="card bars">
        <div className="line" style={{ paddingTop: 0 }}>
          <h3>Доходы и расходы</h3>
          {(() => { const r = savingsRate(monthTotals(data.txs, month)); return r == null ? null : <span className={`pill ${r < 0 ? 'neg' : r < 0.1 ? 'warn-t' : 'pos'}`}>сбережения {Math.round(r * 100)}%</span> })()}
        </div>
        <div className="legend" style={{ margin: '0 0 8px' }}>
          <span><i style={{ background: 'var(--s1)' }} />доходы</span>
          <span><i style={{ background: 'var(--s2)' }} />расходы</span>
        </div>
        <PairBars bars={pairs} selected={month} onSelect={setMonth} hidden={hidden} />
        {!hidden && sel && (
          <div className="line small">
            <span className="muted">{monthLabel(month)}</span>
            <span className="num">+{compact(sel.income)} · −{compact(sel.expense)} = <strong className={sel.income - sel.expense < 0 ? 'neg' : 'pos'}>{sel.income - sel.expense < 0 ? '−' : '+'}{compact(Math.abs(sel.income - sel.expense))}</strong></span>
          </div>
        )}
      </div>

      <div className="card bars">
        <div className="line" style={{ paddingTop: 0 }}>
          <h3>Капитал</h3>
          {!hidden && <span className="num"><Money v={capital.at(-1) ?? 0} round /></span>}
        </div>
        <p className="muted small" style={{ margin: '0 0 6px' }}>сумма на всех счетах на конец месяца</p>
        <LineChart months={pairMonths} values={capital} selected={month} onSelect={setMonth} hidden={hidden} />
      </div>
    </div>
  )
}

function Donut({ slices, total, active, onSelect, children }: {
  slices: Slice[]; total: number; active: string | null; onSelect: (k: string) => void; children: ReactNode
}) {
  const r = 62
  const c = 2 * Math.PI * r
  const gap = slices.length > 1 ? 2.5 : 0
  let offset = 0
  return (
    <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="Структура по категориям">
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--card-2)" strokeWidth="18" />
      {slices.map(s => {
        const len = (s.rub / total) * c
        const el = (
          <circle key={s.key} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth={active === s.key ? 22 : 18}
            strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"
            style={{ cursor: 'pointer', opacity: active && active !== s.key ? 0.35 : 1, transition: 'opacity .15s, stroke-width .15s' }}
            onClick={() => onSelect(s.key)}>
            <title>{`${s.label}: ${formatMoney(s.rub)} (${Math.round((s.rub / total) * 100)}%)`}</title>
          </circle>
        )
        offset += len
        return el
      })}
      {children}
    </svg>
  )
}

/** Столбец со скруглением только сверху; основание прямое, на оси. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return ''
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function compact(minor: number) {
  const rub = minor / 100
  if (rub >= 1_000_000) return `${(rub / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`
  if (rub >= 10_000) return `${Math.round(rub / 1000)} тыс ₽`
  return formatMoney(Math.round(minor / 100) * 100)
}

function PairBars({ bars, selected, onSelect, hidden }: {
  bars: { month: string; income: number; expense: number }[]; selected: string; onSelect: (m: string) => void; hidden: boolean
}) {
  const W = 320, H = 150, top = 10, bottom = 22
  const max = Math.max(1, ...bars.flatMap(b => [b.income, b.expense]))
  const slot = W / bars.length
  const bw = Math.min(13, slot * 0.3)
  const h = (v: number) => (H - top - bottom) * (v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Доходы и расходы по месяцам">
      <line className="grid" x1="0" x2={W} y1={H - bottom} y2={H - bottom} />
      {bars.map((b, i) => {
        const cx = i * slot + slot / 2
        const isSel = b.month === selected
        const m = Number(b.month.slice(5)) - 1
        const hi = h(b.income), he = h(b.expense)
        return (
          <g key={b.month} onClick={() => onSelect(b.month)} style={{ cursor: 'pointer' }} opacity={isSel ? 1 : 0.5}>
            <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
            <path d={roundedTop(cx - bw - 1, H - bottom - hi, bw, hi, Math.min(3, hi))} fill="var(--s1)" />
            <path d={roundedTop(cx + 1, H - bottom - he, bw, he, Math.min(3, he))} fill="var(--s2)" />
            <text x={cx} y={H - 6} textAnchor="middle" fontWeight={isSel ? 700 : 400}>{SHORT_MONTHS[m]}</text>
            <title>{`${monthLabel(b.month)}: доходы ${hidden ? '••••' : formatMoney(b.income)}, расходы ${hidden ? '••••' : formatMoney(b.expense)}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ months, values, selected, onSelect, hidden }: {
  months: string[]; values: number[]; selected: string; onSelect: (m: string) => void; hidden: boolean
}) {
  const W = 320, H = 140, top = 22, bottom = 22, pad = 14
  const min = Math.min(0, ...values), max = Math.max(1, ...values)
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, months.length - 1)
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - min) / (max - min || 1))
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const si = months.indexOf(selected)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Капитал по месяцам">
      <line className="grid" x1="0" x2={W} y1={H - bottom} y2={H - bottom} />
      {min < 0 && <line className="grid" x1="0" x2={W} y1={y(0)} y2={y(0)} strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke="var(--s3)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {months.map((m, i) => (
        <g key={m} onClick={() => onSelect(m)} style={{ cursor: 'pointer' }}>
          <rect x={x(i) - (W / months.length) / 2} y={0} width={W / months.length} height={H} fill="transparent" />
          <circle cx={x(i)} cy={y(values[i])} r={i === si ? 5 : 3} fill={i === si ? 'var(--s3)' : 'var(--card)'} stroke="var(--s3)" strokeWidth="2" />
          <text x={x(i)} y={H - 6} textAnchor="middle" fontWeight={i === si ? 700 : 400}>{SHORT_MONTHS[Number(m.slice(5)) - 1]}</text>
          <title>{`${monthLabel(m)}: ${hidden ? '••••' : formatMoney(values[i])}`}</title>
        </g>
      ))}
      {si >= 0 && !hidden && (
        <text className="bar-val" x={Math.min(W - 34, Math.max(34, x(si)))} y={Math.max(12, y(values[si]) - 10)} textAnchor="middle">{compact(values[si])}</text>
      )}
    </svg>
  )
}
