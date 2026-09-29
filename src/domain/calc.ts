import { monthOf, shiftMonth } from './money'
import type { Account, Allocation, Bucket, Category, Goal, IncomeKind, Limit, Recurring, Settings, Tx } from './types'
import { BUCKETS, REGULAR_INCOME } from './types'

// ---------- Балансы ----------

/** Баланс каждого счёта в его валюте. */
export function balances(accounts: Account[], txs: Tx[]): Map<number, number> {
  const res = new Map<number, number>()
  for (const a of accounts) res.set(a.id!, a.openingBalance)
  const add = (id: number | undefined, v: number) => id != null && res.has(id) && res.set(id, res.get(id)! + v)
  for (const t of txs) {
    if (t.type === 'expense') add(t.accountId, -t.amount)
    else if (t.type === 'income') add(t.accountId, t.amount)
    else {
      add(t.accountId, -t.amount)
      add(t.toAccountId, t.toAmount ?? t.amount)
    }
  }
  return res
}

/** Разница курса при обмене (₽): сколько отдали по ЦБ минус сколько получили по ЦБ. Положительная — потеря. */
export function fxLoss(t: Tx): number {
  if (t.type !== 'transfer' || t.toRub == null) return 0
  return t.rub - t.toRub
}

// ---------- Категории и траты ----------

/** Категория верхнего уровня (конверт), к которой относится трата. */
export function rootOf(categories: Category[], id: number | null | undefined): Category | undefined {
  let c = categories.find(x => x.id === id)
  while (c && c.parentId != null) c = categories.find(x => x.id === c!.parentId)
  return c
}

/** Траты по конвертам за месяц (₽), включая подкатегории и разницу курса. */
export function spentByEnvelope(categories: Category[], txs: Tx[], month: string): Map<number, number> {
  const res = new Map<number, number>()
  const fx = categories.find(c => c.system === 'fx')
  const add = (id: number, v: number) => res.set(id, (res.get(id) ?? 0) + v)
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'expense') {
      const root = rootOf(categories, t.categoryId)
      if (root) add(root.id!, t.rub)
    } else if (t.type === 'transfer' && fx) {
      const loss = fxLoss(t)
      if (loss) add(fx.id!, loss)
    }
  }
  return res
}

/** Лимит конверта в месяце: последняя запись с month <= данного. */
export function limitFor(limits: Limit[], categoryId: number, month: string): number {
  let best: Limit | undefined
  for (const l of limits) {
    if (l.categoryId === categoryId && l.month <= month && (!best || l.month > best.month)) best = l
  }
  return best?.amount ?? 0
}

export interface Envelope {
  category: Category
  limit: number
  spent: number
  carry: number // перенос с прошлых месяцев (может быть отрицательным при перерасходе)
  available: number // limit + carry - spent
}

/**
 * Состояние конвертов в месяце. Остаток (и перерасход) каждого месяца переносится
 * в тот же конверт, начиная с месяца, когда у конверта впервые появился лимит.
 */
export function envelopes(categories: Category[], limits: Limit[], txs: Tx[], month: string): Envelope[] {
  const roots = categories.filter(c => c.parentId == null && !c.archived)
  const spentCache = new Map<string, Map<number, number>>()
  const spentIn = (m: string) => {
    if (!spentCache.has(m)) spentCache.set(m, spentByEnvelope(categories, txs, m))
    return spentCache.get(m)!
  }
  return roots.map(category => {
    const id = category.id!
    const first = limits.filter(l => l.categoryId === id).map(l => l.month).sort()[0]
    let carry = 0
    if (first) {
      for (let m = first; m < month; m = shiftMonth(m, 1)) {
        carry += limitFor(limits, id, m) - (spentIn(m).get(id) ?? 0)
      }
    }
    const limit = limitFor(limits, id, month)
    const spent = spentIn(month).get(id) ?? 0
    return { category, limit, spent, carry, available: limit + carry - spent }
  })
}

// ---------- Месячный план 50/30/20 ----------

/** Доход, на который считается правило: фактический регулярный + ожидаемые, но ещё не пришедшие зарплата/аванс. */
export function planIncome(txs: Tx[], month: string, settings: Settings): number {
  const monthTx = txs.filter(t => t.type === 'income' && monthOf(t.date) === month)
  const regular = monthTx.filter(t => REGULAR_INCOME.includes(t.incomeKind!))
  let total = regular.reduce((s, t) => s + t.rub, 0)
  if (!monthTx.some(t => t.incomeKind === 'salary')) total += settings.expectedSalary
  if (!monthTx.some(t => t.incomeKind === 'advance')) total += settings.expectedAdvance
  return total
}

export function bucketTargets(income: number, settings: Settings): Record<Bucket, number> {
  const r = settings.rule
  const needs = Math.round((income * r.needs) / 100)
  const wants = Math.round((income * r.wants) / 100)
  return { needs, wants, savings: Math.round((income * r.savings) / 100) }
}

export interface BucketState {
  target: number
  planned: number // сумма лимитов конвертов этого типа
  allocated: number // распределено из поступлений
  spent: number // фактически потрачено / отложено
}

/** Сбережения по факту — переводы на счета, к которым привязаны цели. */
export function savedInMonth(txs: Tx[], goals: Goal[], month: string): number {
  const goalAccounts = new Set(goals.map(g => g.accountId))
  let s = 0
  for (const t of txs) {
    if (monthOf(t.date) !== month || t.type !== 'transfer') continue
    const into = goalAccounts.has(t.toAccountId!)
    const out = goalAccounts.has(t.accountId)
    if (into && !out) s += t.toRub ?? t.rub
    if (out && !into) s -= t.rub
  }
  return s
}

export function bucketStates(
  data: { categories: Category[]; limits: Limit[]; txs: Tx[]; allocations: Allocation[]; goals: Goal[] },
  month: string,
  settings: Settings,
): Record<Bucket, BucketState> {
  const targets = bucketTargets(planIncome(data.txs, month, settings), settings)
  const envs = envelopes(data.categories, data.limits, data.txs, month)
  const res = {} as Record<Bucket, BucketState>
  for (const b of BUCKETS) {
    const own = envs.filter(e => e.category.bucket === b)
    res[b] = {
      target: targets[b],
      planned: own.reduce((s, e) => s + e.limit, 0),
      allocated: data.allocations.filter(a => a.month === month).reduce((s, a) => s + a[b], 0),
      spent: own.reduce((s, e) => s + e.spent, 0),
    }
  }
  res.savings.spent += savedInMonth(data.txs, data.goals, month)
  return res
}

// ---------- Распределение поступления ----------

export interface Reserve {
  recurring: Recurring
  rub: number
}

export interface Distribution {
  income: number
  reserves: Reserve[]
  split: Record<Bucket, number> // без учёта резервов; резервы уже входят в нужды
  goalSuggestions: { goal: Goal; rub: number }[]
}

function splitByWeights(total: number, weights: Record<Bucket, number>): Record<Bucket, number> {
  const sum = BUCKETS.reduce((s, b) => s + weights[b], 0)
  const res = { needs: 0, wants: 0, savings: 0 }
  if (total <= 0 || sum <= 0) return res
  let rest = total
  for (const b of BUCKETS.slice(0, -1)) {
    res[b] = Math.floor((total * weights[b]) / sum)
    rest -= res[b]
  }
  res.savings = rest
  return res
}

/**
 * Предложение, как разложить поступление.
 * Регулярный доход: сначала резервы на привязанные к этой выплате регулярные платежи,
 * остаток — так, чтобы месяц в целом пришёл к 50/30/20 (с учётом уже распределённого).
 * Нерегулярный (от родителей, другое): по умолчанию всё в сбережения.
 */
export function suggestDistribution(
  tx: Tx,
  /** goalRemainingRub — сколько рублей осталось до каждой цели. */
  data: { txs: Tx[]; allocations: Allocation[]; recurring: Recurring[]; goals: Goal[]; goalRemainingRub: Map<number, number> },
  settings: Settings,
  recurringToRub: (r: Recurring) => number,
): Distribution {
  const month = monthOf(tx.date)
  const kind = tx.incomeKind as IncomeKind
  const income = tx.rub
  let split: Record<Bucket, number>
  let reserves: Reserve[] = []

  if (REGULAR_INCOME.includes(kind)) {
    reserves = data.recurring
      .filter(r => r.active && r.fundFrom === kind)
      .map(r => ({ recurring: r, rub: recurringToRub(r) }))
    const reserved = reserves.reduce((s, r) => s + r.rub, 0)
    const free = Math.max(0, income - reserved)

    const targets = bucketTargets(planIncome(data.txs, month, settings), settings)
    const already = { needs: 0, wants: 0, savings: 0 }
    for (const a of data.allocations) {
      if (a.month !== month || a.txId === tx.id) continue
      for (const b of BUCKETS) already[b] += a[b]
    }
    const gap = {
      needs: Math.max(0, targets.needs - already.needs - reserved),
      wants: Math.max(0, targets.wants - already.wants),
      savings: Math.max(0, targets.savings - already.savings),
    }
    const gapTotal = gap.needs + gap.wants + gap.savings
    split = splitByWeights(Math.min(free, gapTotal), gap)
    // Если поступление больше, чем осталось добрать до плана, излишек — по правилу.
    const extra = splitByWeights(free - Math.min(free, gapTotal), settings.rule)
    for (const b of BUCKETS) split[b] += extra[b]
  } else {
    split = { needs: 0, wants: 0, savings: income }
  }

  return { income, reserves, split, goalSuggestions: suggestGoals(split.savings, data.goals, data.goalRemainingRub) }
}

/** Раскладывает сумму сбережений по незакрытым целям в порядке приоритета. */
export function suggestGoals(
  savings: number,
  goals: Goal[],
  remainingRub: Map<number, number>,
): { goal: Goal; rub: number }[] {
  const res: { goal: Goal; rub: number }[] = []
  let left = savings
  for (const g of [...goals].sort((a, b) => a.priority - b.priority)) {
    if (left <= 0) break
    const need = remainingRub.get(g.id!) ?? 0
    if (need <= 0) continue
    const rub = Math.min(left, need)
    res.push({ goal: g, rub })
    left -= rub
  }
  return res
}

// ---------- Цели ----------

export interface GoalProgress {
  goal: Goal
  saved: number // в валюте счёта
  remaining: number
}

/** Баланс счёта заполняет цели на нём по очереди приоритета. */
export function goalProgress(goals: Goal[], bal: Map<number, number>): GoalProgress[] {
  const left = new Map(bal)
  return [...goals]
    .sort((a, b) => a.priority - b.priority)
    .map(goal => {
      const avail = Math.max(0, left.get(goal.accountId) ?? 0)
      const saved = Math.min(avail, goal.target)
      left.set(goal.accountId, avail - saved)
      return { goal, saved, remaining: goal.target - saved }
    })
}

/** Что сохраняется при принятии распределения: резервы входят в нужды. */
export function allocationOf(d: Distribution, split = d.split): Record<Bucket, number> {
  const reserved = d.reserves.reduce((s, r) => s + r.rub, 0)
  return { needs: split.needs + reserved, wants: split.wants, savings: split.savings }
}

// ---------- Главная, календарь, аналитика ----------

/** Доходы и расходы за месяц (₽). Разница курса при обмене считается расходом. */
export function monthTotals(txs: Tx[], month: string): { income: number; expense: number } {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'income') income += t.rub
    else if (t.type === 'expense') expense += t.rub
    else expense += fxLoss(t)
  }
  return { income, expense }
}

/** Среднее за N месяцев перед данным (для сравнения «≈ ср.»). Месяцы без операций не учитываются. */
export function monthAverage(txs: Tx[], month: string, n = 3): { income: number; expense: number } | null {
  const months = Array.from({ length: n }, (_, i) => shiftMonth(month, -(i + 1)))
  const withData = months.filter(m => txs.some(t => monthOf(t.date) === m))
  if (!withData.length) return null
  const sum = withData.map(m => monthTotals(txs, m)).reduce((a, b) => ({ income: a.income + b.income, expense: a.expense + b.expense }))
  return { income: Math.round(sum.income / withData.length), expense: Math.round(sum.expense / withData.length) }
}

/** Изменение общего капитала (₽) начиная с даты включительно. */
export function netChangeSince(txs: Tx[], fromDate: string): number {
  let s = 0
  for (const t of txs) {
    if (t.date < fromDate) continue
    if (t.type === 'income') s += t.rub
    else if (t.type === 'expense') s -= t.rub
    else s -= fxLoss(t)
  }
  return s
}

export type PlannedEvent =
  | { date: string; kind: 'payment'; recurring: Recurring }
  | { date: string; kind: 'salary' | 'advance'; amount: number }

const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate()
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Плановые события месяца: регулярные платежи и дни выплат. День 31 в коротком месяце — последний день. */
export function plannedInMonth(recurring: Recurring[], settings: Settings, month: string): PlannedEvent[] {
  const [y, m] = month.split('-').map(Number)
  const day = (d: number) => iso(y, m, Math.min(d, daysIn(y, m)))
  const events: PlannedEvent[] = [
    { date: day(settings.salaryDay), kind: 'salary', amount: settings.expectedSalary },
    { date: day(settings.advanceDay), kind: 'advance', amount: settings.expectedAdvance },
    ...recurring.filter(r => r.active).map(r => ({ date: day(r.day), kind: 'payment' as const, recurring: r })),
  ]
  return events.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ближайшие плановые события начиная с даты, на `days` дней вперёд. */
export function upcoming(recurring: Recurring[], settings: Settings, from: string, days = 31): PlannedEvent[] {
  const end = new Date(from + 'T00:00:00')
  end.setDate(end.getDate() + days)
  const to = iso(end.getFullYear(), end.getMonth() + 1, end.getDate())
  const months = [monthOf(from), shiftMonth(monthOf(from), 1), shiftMonth(monthOf(from), 2)]
  return months.flatMap(m => plannedInMonth(recurring, settings, m)).filter(e => e.date >= from && e.date <= to)
}

/** Расходы по конвертам за диапазон месяцев (включительно), по убыванию. */
export function spendByRoot(categories: Category[], txs: Tx[], from: string, to: string): { category: Category; rub: number }[] {
  const sums = new Map<number, number>()
  for (let m = from; m <= to; m = shiftMonth(m, 1)) {
    for (const [id, v] of spentByEnvelope(categories, txs, m)) sums.set(id, (sums.get(id) ?? 0) + v)
  }
  return [...sums]
    .map(([id, rub]) => ({ category: categories.find(c => c.id === id)!, rub }))
    .filter(x => x.category && x.rub > 0)
    .sort((a, b) => b.rub - a.rub)
}

/** Доходы по видам за диапазон месяцев, по убыванию. */
export function incomeByKind(txs: Tx[], from: string, to: string): { kind: IncomeKind; rub: number }[] {
  const sums = new Map<IncomeKind, number>()
  for (const t of txs) {
    const m = monthOf(t.date)
    if (t.type !== 'income' || m < from || m > to) continue
    sums.set(t.incomeKind!, (sums.get(t.incomeKind!) ?? 0) + t.rub)
  }
  return [...sums].map(([kind, rub]) => ({ kind, rub })).sort((a, b) => b.rub - a.rub)
}
