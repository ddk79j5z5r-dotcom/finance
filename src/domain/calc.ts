import type { Trade } from './bonds'
import { monthOf, shiftMonth } from './money'
import type { Account, AccountColor, AccountKind, Bucket, Category, Goal, IncomeKind, Limit, Recurring, Settings, Tx } from './types'
import { ACCOUNT_COLORS, BUCKETS, REGULAR_INCOME } from './types'

// ---------- Балансы ----------

/** Баланс (свободные деньги) каждого счёта в его валюте. Сделки с облигациями переводят деньги в бумаги и обратно. */
export function balances(accounts: Account[], txs: Tx[], trades: Trade[] = []): Map<number, number> {
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
  for (const t of trades) add(t.accountId, t.type === 'buy' ? -t.amount : t.amount)
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
  available: number // limit − spent; каждый месяц конверт начинается заново, без переноса
}

/** Состояние конвертов в месяце. Лимит действует, пока не изменён; остаток и перерасход в следующий месяц не переходят. */
export function envelopes(categories: Category[], limits: Limit[], txs: Tx[], month: string): Envelope[] {
  const roots = categories.filter(c => c.parentId == null && !c.archived)
  const spent = spentByEnvelope(categories, txs, month)
  return roots.map(category => {
    const limit = limitFor(limits, category.id!, month)
    const s = spent.get(category.id!) ?? 0
    return { category, limit, spent: s, available: limit - s }
  })
}

// ---------- Месячный план 50/30/20 ----------

/** Доход, на который считается правило: фактический регулярный + ожидаемые, но ещё не пришедшие зарплата/аванс. */
/** База правила: весь доход месяца + ожидаемые, но ещё не пришедшие зарплата и аванс. */
export function planIncome(txs: Tx[], month: string, settings: Settings): number {
  const monthTx = txs.filter(t => t.type === 'income' && monthOf(t.date) === month)
  let total = monthTx.reduce((s, t) => s + t.rub, 0)
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
  target: number // рекомендация: доля базы
  planned: number // сумма лимитов конвертов этого типа
  spent: number // нужды/желания — траты по категориям; сбережения — отложено на сберегательные счета
}

/** Счёт учитывается в 50/30/20 как сбережения: явный флажок, иначе — если на нём есть цель. */
export function isSavingsAccount(a: Account, goals: Goal[]): boolean {
  return a.savings ?? goals.some(g => g.accountId === a.id)
}

/**
 * Сбережения по факту (₽): чистые переводы на сберегательные счета за месяц
 * плюс проценты и купоны, пришедшие прямо на них. Покупка облигаций внутри счёта сюда не входит.
 */
export function savedInMonth(txs: Tx[], accounts: Account[], goals: Goal[], month: string): number {
  const saving = new Set(accounts.filter(a => isSavingsAccount(a, goals)).map(a => a.id!))
  let s = 0
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'transfer') {
      const into = saving.has(t.toAccountId!)
      const out = saving.has(t.accountId)
      if (into && !out) s += t.toRub ?? t.rub
      if (out && !into) s -= t.rub
    } else if (t.type === 'income' && t.incomeKind === 'interest' && saving.has(t.accountId)) s += t.rub
  }
  return s
}

/** Тип траты: по самой категории операции (у подкатегории может быть свой тип, отличный от родителя). */
export function bucketOf(categories: Category[], id: number | null | undefined): Bucket | undefined {
  return categories.find(c => c.id === id)?.bucket ?? rootOf(categories, id)?.bucket
}

/** Траты месяца по типам (₽) с учётом типа подкатегорий; разница курса — по типу своей служебной категории. */
export function spentByBucket(categories: Category[], txs: Tx[], month: string): Record<Bucket, number> {
  const res = { needs: 0, wants: 0, savings: 0 }
  const fx = categories.find(c => c.system === 'fx')
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'expense') {
      const b = bucketOf(categories, t.categoryId)
      if (b) res[b] += t.rub
    } else if (t.type === 'transfer' && fx) res[fx.bucket] += fxLoss(t)
  }
  return res
}

export function bucketStates(
  data: { categories: Category[]; limits: Limit[]; txs: Tx[]; goals: Goal[]; accounts: Account[] },
  month: string,
  settings: Settings,
): Record<Bucket, BucketState> {
  const targets = bucketTargets(planIncome(data.txs, month, settings), settings)
  const envs = envelopes(data.categories, data.limits, data.txs, month)
  const spent = spentByBucket(data.categories, data.txs, month)
  const res = {} as Record<Bucket, BucketState>
  for (const b of BUCKETS) {
    const own = envs.filter(e => e.category.bucket === b)
    res[b] = {
      target: targets[b],
      planned: own.reduce((s, e) => s + e.limit, 0),
      spent: spent[b],
    }
  }
  res.savings.spent += savedInMonth(data.txs, data.accounts, data.goals, month)
  return res
}

/** Свободный остаток месяца: пришло − потрачено − отложено на сберегательные счета. */
export function freeInMonth(data: { txs: Tx[]; goals: Goal[]; accounts: Account[] }, month: string): number {
  const t = monthTotals(data.txs, month)
  return t.income - t.expense - savedInMonth(data.txs, data.accounts, data.goals, month)
}

// ---------- Распределение поступления (рекомендация) ----------

const isBefore = (a: Tx, b: Tx) =>
  a.date < b.date || (a.date === b.date && (a.createdAt < b.createdAt || (a.createdAt === b.createdAt && (a.id ?? 0) < (b.id ?? 0))))

export interface Reserve {
  recurring: Recurring
  rub: number
  bucket: Bucket
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
  /** goalRemainingRub — сколько рублей осталось до каждой цели; goalMonthLeftRub — сколько ещё нужно в этом месяце целям со сроком. */
  data: {
    txs: Tx[]; recurring: Recurring[]; goals: Goal[]; categories?: Category[]
    goalRemainingRub: Map<number, number>; goalMonthLeftRub?: Map<number, number>
  },
  settings: Settings,
  recurringToRub: (r: Recurring) => number,
): Distribution {
  const month = monthOf(tx.date)
  const kind = tx.incomeKind as IncomeKind
  const income = tx.rub
  let split: Record<Bucket, number>
  let reserves: Reserve[] = []
  // Рекомендация — на момент прихода денег: более поздние поступления её не меняют.
  const asOf = data.txs.filter(t => t.type !== 'income' || t === tx || (tx.id != null && t.id === tx.id) || isBefore(t, tx))

  if (REGULAR_INCOME.includes(kind)) {
    reserves = data.recurring
      .filter(r => r.active && (r.fundFrom === kind || r.fundFrom === 'both'))
      .map(r => {
        const full = recurringToRub(r)
        return { recurring: r, rub: r.fundFrom === 'both' ? Math.round(full / 2) : full, bucket: bucketOf(data.categories ?? [], r.categoryId) ?? 'needs' }
      })
    const reservedBy = { needs: 0, wants: 0, savings: 0 }
    for (const r of reserves) reservedBy[r.bucket] += r.rub
    const reserved = reserves.reduce((s, r) => s + r.rub, 0)
    const free = Math.max(0, income - reserved)

    const targets = bucketTargets(planIncome(asOf, month, settings), settings)
    // Что уже «разложено» предыдущими выплатами месяца — по той же формуле, без сохранённых записей.
    const already = { needs: 0, wants: 0, savings: 0 }
    const earlier = asOf.filter(t => t.type === 'income' && monthOf(t.date) === month && t !== tx
      && REGULAR_INCOME.includes(t.incomeKind!) && isBefore(t, tx))
    for (const e of earlier) {
      const prior = allocationOf(suggestDistribution(e, { ...data, txs: asOf }, settings, recurringToRub))
      for (const b of BUCKETS) already[b] += prior[b]
    }
    const gap = {
      needs: Math.max(0, targets.needs - already.needs - reservedBy.needs),
      wants: Math.max(0, targets.wants - already.wants - reservedBy.wants),
      savings: Math.max(0, targets.savings - already.savings - reservedBy.savings),
    }
    const gapTotal = gap.needs + gap.wants + gap.savings
    split = splitByWeights(Math.min(free, gapTotal), gap)
    // Если поступление больше, чем осталось добрать до плана, излишек — по правилу.
    const extra = splitByWeights(free - Math.min(free, gapTotal), settings.rule)
    for (const b of BUCKETS) split[b] += extra[b]
  } else {
    split = { needs: 0, wants: 0, savings: income }
  }

  return { income, reserves, split, goalSuggestions: suggestGoals(split.savings, data.goals, data.goalRemainingRub, data.goalMonthLeftRub) }
}

/**
 * Раскладывает сумму сбережений по целям: сначала целям со сроком — сколько им ещё нужно в этом месяце,
 * затем остаток по всем незакрытым целям в порядке приоритета.
 */
export function suggestGoals(
  savings: number,
  goals: Goal[],
  remainingRub: Map<number, number>,
  monthLeftRub: Map<number, number> = new Map(),
): { goal: Goal; rub: number }[] {
  const given = new Map<number, number>()
  let left = savings
  const sorted = [...goals].sort((a, b) => a.priority - b.priority)
  const give = (g: Goal, cap: number) => {
    const room = (remainingRub.get(g.id!) ?? 0) - (given.get(g.id!) ?? 0)
    const rub = Math.max(0, Math.min(left, cap, room))
    if (rub > 0) { given.set(g.id!, (given.get(g.id!) ?? 0) + rub); left -= rub }
  }
  for (const g of sorted) if (g.deadline) give(g, monthLeftRub.get(g.id!) ?? 0)
  for (const g of sorted) give(g, Infinity)
  return sorted.filter(g => given.has(g.id!)).map(g => ({ goal: g, rub: given.get(g.id!)! }))
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
  const res = { ...split }
  for (const r of d.reserves) res[r.bucket] += r.rub
  return res
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
    ...recurring.filter(r => r.active && r.kind !== 'topup').map(r => ({ date: day(r.day), kind: 'payment' as const, recurring: r })),
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

// ---------- Прогноз, норма сбережений, капитал ----------

/** Доля дохода, которая осталась несъеденной: (доходы − расходы) / доходы. null, если доходов нет. */
export function savingsRate(t: { income: number; expense: number }): number | null {
  if (t.income <= 0) return null
  return (t.income - t.expense) / t.income
}

export interface Forecast {
  income: number // ожидаемый доход за месяц (факт + ещё не пришедшие зарплата/аванс)
  expense: number // ожидаемые расходы
  balance: number // income − expense
  fixedLeft: number // неоплаченные регулярные платежи
  variablePace: number // переменные траты за весь месяц: уже потрачено + оценка до конца
}

/** Был ли регулярный платёж уже оплачен в этом месяце: расход той же категории на сумму ±10% (или с его названием). */
export function isPaid(r: Recurring, txs: Tx[], month: string, rubOf: (r: Recurring) => number = x => x.amount): boolean {
  const target = rubOf(r)
  return txs.some(t => t.type === 'expense' && monthOf(t.date) === month && t.categoryId === r.categoryId &&
    (t.comment === r.name || Math.abs(t.rub - target) <= target * 0.1))
}

/**
 * Прогноз до конца месяца. Регулярные платежи считаются фиксированными: оплаченные — по факту,
 * остальные — по плану. Остальные траты экстраполируются по темпу с начала месяца.
 */
export function monthForecast(
  data: { txs: Tx[]; recurring: Recurring[] },
  settings: Settings,
  today: string,
  rubOf: (r: Recurring) => number = x => x.amount,
): Forecast {
  const month = monthOf(today)
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const elapsed = Number(today.slice(8))
  // Пополнения копилок — не расход: расходом станут сами траты по категории.
  const active = data.recurring.filter(r => r.active && r.kind !== 'topup')
  const fixedCats = new Set(active.map(r => r.categoryId))

  const totals = monthTotals(data.txs, month)
  let variable = 0
  let fixedPaid = 0
  for (const t of data.txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'expense') {
      if (t.categoryId != null && fixedCats.has(t.categoryId)) fixedPaid += t.rub
      else variable += t.rub
    } else if (t.type === 'transfer') variable += fxLoss(t)
  }
  const fixedLeft = active.filter(r => !isPaid(r, data.txs, month, rubOf)).reduce((s, r) => s + rubOf(r), 0)

  // Темп переменных трат: в начале месяца данных мало, поэтому опираемся на средний дневной темп
  // прошлых 3 месяцев (как на 7 «виртуальных» дней) и по мере накопления дней переходим на текущий.
  const prevDaily: number[] = []
  for (let i = 1; i <= 3; i++) {
    const pm = shiftMonth(month, -i)
    if (!data.txs.some(t => monthOf(t.date) === pm)) continue
    const [py, pmm] = pm.split('-').map(Number)
    let v = 0
    for (const t of data.txs) {
      if (monthOf(t.date) !== pm) continue
      if (t.type === 'expense' && !(t.categoryId != null && fixedCats.has(t.categoryId))) v += t.rub
      else if (t.type === 'transfer') v += fxLoss(t)
    }
    prevDaily.push(v / new Date(py, pmm, 0).getDate())
  }
  const K = 7
  const current = elapsed > 0 ? variable / elapsed : 0
  const prior = prevDaily.length ? prevDaily.reduce((a, b) => a + b, 0) / prevDaily.length : current
  const daily = (variable + prior * K) / (elapsed + K)
  const variablePace = Math.round(variable + daily * (days - elapsed))
  const expense = fixedPaid + fixedLeft + variablePace

  const got = (k: string) => data.txs.some(t => t.type === 'income' && t.incomeKind === k && monthOf(t.date) === month)
  const income = totals.income + (got('salary') ? 0 : settings.expectedSalary) + (got('advance') ? 0 : settings.expectedAdvance)
  return { income, expense, balance: income - expense, fixedLeft, variablePace }
}

/** Капитал (₽) на конец каждого месяца: стартовые балансы рублёвых счетов + все движения до конца месяца. */
export function capitalByMonth(accounts: Account[], txs: Tx[], months: string[], toRub: (minor: number, a: Account) => number): number[] {
  const opening = accounts.reduce((s, a) => s + toRub(a.openingBalance, a), 0)
  return months.map(m => opening + netChangeSince(txs.filter(t => monthOf(t.date) <= m), '0000-00-00'))
}

// ---------- Переводы по копилкам при распределении ----------

export interface PlannedTransfer {
  accountId: number
  rub: number
  reasons: string[]
}

/** Куда разложить поступление по счетам-копилкам: резервы под платежи и подсказки по целям. */
export function transfersFor(d: Distribution, fromAccountId: number): PlannedTransfer[] {
  const map = new Map<number, PlannedTransfer>()
  const add = (accountId: number | null | undefined, rub: number, reason: string) => {
    if (accountId == null || accountId === fromAccountId || rub <= 0) return
    const cur = map.get(accountId) ?? { accountId, rub: 0, reasons: [] }
    cur.rub += rub
    cur.reasons.push(reason)
    map.set(accountId, cur)
  }
  for (const r of d.reserves) add(r.recurring.reserveAccountId, r.rub, r.recurring.name)
  for (const g of d.goalSuggestions) add(g.goal.accountId, g.rub, g.goal.name)
  return [...map.values()]
}

// ---------- Порядок счетов при вводе ----------

const CARD_NAME = /банк|карт|сбер|тинькофф|т-банк|псб|альфа|втб|газпром|райф|озон|яндекс|мтс|налич|кошел|visa|mastercard/i

export function accountKind(a: Account): AccountKind {
  return a.kind ?? (CARD_NAME.test(a.name) ? 'card' : 'savings')
}

/**
 * Счета для ввода операции: сначала карты, затем копилки. Внутри — основной счёт первым,
 * дальше по частоте использования за 90 дней (как источник расхода/дохода), затем по порядку.
 */
export function accountsForEntry(accounts: Account[], txs: Tx[], defaultId: number | null, today: string, type: Tx['type'] = 'expense'): Account[] {
  const since = new Date(today + 'T00:00:00')
  since.setDate(since.getDate() - 90)
  const from = since.toISOString().slice(0, 10)
  const use = new Map<number, number>()
  for (const t of txs) {
    if (t.date < from) continue
    if (type === 'transfer' ? t.type === 'transfer' : t.type === type) use.set(t.accountId, (use.get(t.accountId) ?? 0) + 1)
  }
  const rank = (a: Account) => ({ card: 0, savings: 1, broker: 2 })[accountKind(a)]
  return [...accounts].sort((a, b) =>
    rank(a) - rank(b) ||
    Number(b.id === defaultId) - Number(a.id === defaultId) ||
    (use.get(b.id!) ?? 0) - (use.get(a.id!) ?? 0) ||
    a.order - b.order)
}

// ---------- Цели со сроком ----------

/** Месяцев от текущего до срока включительно (минимум 1). */
export function monthsUntil(month: string, deadline: string): number {
  const [y1, m1] = month.split('-').map(Number)
  const [y2, m2] = deadline.split('-').map(Number)
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1)
}

export interface GoalMonthPlan {
  monthly: number // сколько нужно откладывать в месяц (в валюте счёта)
  done: number // уже отложено в этом месяце
  left: number // осталось отложить в этом месяце
}

/**
 * План целей со сроком на месяц. Вклад месяца — чистые переводы на счёт цели в этом месяце,
 * распределённые по целям со сроком на этом счёте в порядке приоритета.
 */
export function goalMonthPlans(goals: Goal[], progress: GoalProgress[], txs: Tx[], month: string): Map<number, GoalMonthPlan> {
  const net = new Map<number, number>()
  for (const t of txs) {
    if (t.type !== 'transfer' || monthOf(t.date) !== month) continue
    net.set(t.toAccountId!, (net.get(t.toAccountId!) ?? 0) + (t.toAmount ?? t.amount))
    net.set(t.accountId, (net.get(t.accountId) ?? 0) - t.amount)
  }
  const pool = new Map([...net].map(([k, v]) => [k, Math.max(0, v)]))
  const res = new Map<number, GoalMonthPlan>()
  for (const g of [...goals].sort((a, b) => a.priority - b.priority)) {
    if (!g.deadline) continue
    const remaining = progress.find(p => p.goal.id === g.id)?.remaining ?? g.target
    const avail = pool.get(g.accountId) ?? 0
    // Сколько было до начала месяца: сегодняшний остаток + уже отложенное в этом месяце.
    const startRemaining = remaining + Math.min(avail, g.target)
    const monthly = Math.ceil(startRemaining / monthsUntil(month, g.deadline))
    const done = Math.min(avail, monthly)
    pool.set(g.accountId, avail - done)
    res.set(g.id!, { monthly, done, left: Math.max(0, Math.min(monthly - done, remaining)) })
  }
  return res
}

// ---------- Счета: цвет ----------

const COLOR_BY_NAME: [RegExp, AccountColor][] = [
  [/тинькофф|т-банк|tinkoff/i, 'yellow'], [/сбер/i, 'green'], [/псб|втб/i, 'blue'], [/альфа/i, 'pink'], [/газпром|озон/i, 'sky'],
]

export function accountColor(a: Account, all: Account[]): AccountColor {
  if (a.color) return a.color
  const byName = COLOR_BY_NAME.find(([re]) => re.test(a.name))?.[1]
  if (byName) return byName
  const rest = ACCOUNT_COLORS.filter(c => c !== 'yellow' && c !== 'green')
  const idx = all.filter(x => !COLOR_BY_NAME.some(([re]) => re.test(x.name))).findIndex(x => x.id === a.id)
  return rest[Math.max(0, idx) % rest.length]
}

// ---------- Первая настройка ----------

export type SetupStep = 'pay' | 'recurring' | 'goals' | 'categories' | 'security' | 'backup'

export function setupSteps(
  d: { settings: Settings; recurring: Recurring[]; goals: Goal[] },
  lockEnabled: boolean,
): { id: SetupStep; label: string; done: boolean }[] {
  const active = d.recurring.filter(r => r.active)
  return [
    { id: 'pay', label: 'Ожидаемые зарплата и аванс', done: d.settings.expectedSalary > 0 && d.settings.expectedAdvance > 0 },
    { id: 'recurring', label: 'Регулярные платежи с копилками', done: active.length > 0 && active.every(r => r.reserveAccountId != null) },
    { id: 'goals', label: 'Цели на копилках', done: d.goals.length > 0 },
    { id: 'categories', label: 'Проверить типы категорий', done: !!d.settings.categoriesReviewed },
    { id: 'security', label: 'Face ID или PIN', done: lockEnabled },
    { id: 'backup', label: 'Первый бэкап в Excel', done: d.settings.lastExportAt != null },
  ]
}
