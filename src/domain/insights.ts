import { fxLoss, rootOf } from './calc'
import { monthOf, shiftMonth } from './money'
import type { Category, Tx } from './types'

// ---------- Аналитика: траты к этому дню, сравнение со средним, запас ----------

export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Расход операции (₽): трата или потеря на разнице курса при обмене. */
const spendOf = (t: Tx) => (t.type === 'expense' ? t.rub : t.type === 'transfer' ? fxLoss(t) : 0)

/** Траты месяца нарастающим итогом по дням (₽): [к 1-му, к 2-му, …, к последнему]. */
export function cumulativeSpend(txs: Tx[], month: string): number[] {
  const daily = new Array(daysInMonth(month)).fill(0)
  for (const t of txs) if (monthOf(t.date) === month) daily[Number(t.date.slice(8)) - 1] += spendOf(t)
  let acc = 0
  return daily.map(v => (acc += v))
}

/** Прошлые месяцы с тратами (до n штук) — база для «в среднем». */
export function previousMonths(txs: Tx[], month: string, n = 3): string[] {
  const res: string[] = []
  for (let i = 1; i <= 12 && res.length < n; i++) {
    const m = shiftMonth(month, -i)
    if (txs.some(t => monthOf(t.date) === m && spendOf(t) > 0)) res.push(m)
  }
  return res
}

/**
 * Средние траты нарастающим итогом по дням текущего месяца — по прошлым месяцам с данными.
 * Если в прошлом месяце дней меньше, последние дни берутся по его итогу.
 */
export function averageCumulative(txs: Tx[], month: string, n = 3): number[] | null {
  const prev = previousMonths(txs, month, n)
  if (!prev.length) return null
  const curves = prev.map(m => cumulativeSpend(txs, m))
  return Array.from({ length: daysInMonth(month) }, (_, d) =>
    Math.round(curves.reduce((s, c) => s + c[Math.min(d, c.length - 1)], 0) / curves.length))
}

/** Траты по корневым категориям с 1-го по день `day` включительно (₽). */
export function spendToDayByRoot(categories: Category[], txs: Tx[], month: string, day: number): Map<number, number> {
  const res = new Map<number, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || monthOf(t.date) !== month || Number(t.date.slice(8)) > day) continue
    const root = rootOf(categories, t.categoryId)
    if (root?.id != null) res.set(root.id, (res.get(root.id) ?? 0) + t.rub)
  }
  return res
}

export interface CategoryDelta {
  category: Category
  /** Потрачено в этом месяце к дню. */
  now: number
  /** В среднем к этому же дню в прошлые месяцы. */
  avg: number
  diff: number
}

/** Категории: сколько потрачено к этому дню против среднего к тому же дню. От самого большого роста к самому большому снижению. */
export function categoryDeltas(categories: Category[], txs: Tx[], month: string, day: number, n = 3): CategoryDelta[] {
  const prev = previousMonths(txs, month, n)
  const now = spendToDayByRoot(categories, txs, month, day)
  const sums = new Map<number, number>()
  for (const m of prev) {
    for (const [id, v] of spendToDayByRoot(categories, txs, m, Math.min(day, daysInMonth(m)))) sums.set(id, (sums.get(id) ?? 0) + v)
  }
  const ids = new Set([...now.keys(), ...sums.keys()])
  return [...ids]
    .map(id => {
      const category = categories.find(c => c.id === id)!
      const avg = prev.length ? Math.round((sums.get(id) ?? 0) / prev.length) : 0
      const v = now.get(id) ?? 0
      return { category, now: v, avg, diff: v - avg }
    })
    .filter(x => x.category && !x.category.system)
    .sort((a, b) => b.diff - a.diff)
}

/** Средние траты в день (₽): по прошлым месяцам с данными, иначе — по текущему месяцу до сегодня. */
export function averageDailySpend(txs: Tx[], today: string, n = 3): number {
  const month = monthOf(today)
  const prev = previousMonths(txs, month, n)
  if (prev.length) {
    const total = prev.reduce((s, m) => s + (cumulativeSpend(txs, m).at(-1) ?? 0), 0)
    const days = prev.reduce((s, m) => s + daysInMonth(m), 0)
    return Math.round(total / days)
  }
  const day = Number(today.slice(8))
  return Math.round((cumulativeSpend(txs, month)[day - 1] ?? 0) / day)
}

/** На сколько дней хватит денег при средних тратах. */
export function reserveDays(capital: number, dailySpend: number): number | null {
  return dailySpend > 0 && capital > 0 ? Math.floor(capital / dailySpend) : null
}

/**
 * «Новая финансовая высота»: круглая отметка, которую капитал перешёл впервые
 * (выше, чем на конец любого прошлого месяца). Шаг: 10 тыс до 100 тыс, 50 тыс до 1 млн, дальше 100 тыс.
 */
export function capitalMilestone(current: number, history: number[]): number | null {
  const step = current < 100_000_00 ? 10_000_00 : current < 1_000_000_00 ? 50_000_00 : 100_000_00
  const mark = Math.floor(current / step) * step
  const best = Math.max(0, ...history)
  return mark > 0 && mark > best ? mark : null
}

/** Корневые категории месяца до дня: где чаще всего (по числу трат) или больше всего (по сумме) тратишь. */
export function topCategories(categories: Category[], txs: Tx[], month: string, day: number, by: 'count' | 'sum', limit = 3): { category: Category; count: number; rub: number }[] {
  const map = new Map<number, { count: number; rub: number }>()
  for (const t of txs) {
    if (t.type !== 'expense' || monthOf(t.date) !== month || Number(t.date.slice(8)) > day) continue
    const root = rootOf(categories, t.categoryId)
    if (root?.id == null || root.system) continue
    const cur = map.get(root.id) ?? { count: 0, rub: 0 }
    cur.count++
    cur.rub += t.rub
    map.set(root.id, cur)
  }
  return [...map]
    .map(([id, v]) => ({ category: categories.find(c => c.id === id)!, ...v }))
    .sort((a, b) => (by === 'count' ? b.count - a.count || b.rub - a.rub : b.rub - a.rub))
    .slice(0, limit)
}
