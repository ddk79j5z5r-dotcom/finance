import type { Trade } from './bonds'
import { monthOf, shiftMonth } from './money'
import { expectedPay, extrasForMonth, extraTx } from './pay'
import type { Account, AccountColor, AccountKind, Category, Goal, IncomeKind, Limit, Recurring, Settings, Tx } from './types'
import { ACCOUNT_COLORS, REGULAR_INCOME } from './types'

// ---------- Балансы ----------

/** Баланс (свободные деньги) каждого счёта в его валюте. Сделки с облигациями переводят деньги в бумаги и обратно. */
export function balances(accounts: Account[], txs: Tx[], trades: Trade[] = []): Map<number, number> {
  const res = new Map<number, number>()
  for (const a of accounts) res.set(a.id!, a.openingBalance)
  const add = (id: number | undefined, v: number) => id != null && res.has(id) && res.set(id, res.get(id)! + v)
  for (const t of txs) {
    if (t.type === 'expense') add(t.accountId, -t.amount)
    else if (t.type === 'income' || t.type === 'refund') add(t.accountId, t.amount)
    else if (t.type === 'adjust') add(t.accountId, t.amount) // корректировка: сумма со знаком
    else {
      add(t.accountId, -t.amount)
      add(t.toAccountId, t.toAmount ?? t.amount)
    }
  }
  for (const t of trades) add(t.accountId, t.type === 'buy' ? -t.amount : t.amount)
  return res
}

/** Разница курса при обмене (₽): сколько отдали по ЦБ минус сколько получили по ЦБ. Положительная — потеря. */
/**
 * Потребительский расход операции (₽): расход — плюс, возврат покупки — минус (в месяце возврата),
 * потеря на курсе при обмене — плюс. Переводы (в том числе погашение кредита, выдача долга, пополнение
 * копилки или брокерского счёта), доходы и корректировки — не расход.
 */
export function spendRub(t: Tx): number {
  if (t.type === 'expense') return t.rub
  if (t.type === 'refund') return -t.rub
  if (t.type === 'transfer') return fxLoss(t)
  return 0
}

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
    if (t.type === 'expense' || t.type === 'refund') {
      const root = rootOf(categories, t.categoryId)
      if (root) add(root.id!, spendRub(t))
    } else if (t.type === 'transfer' && fx) {
      const loss = fxLoss(t)
      if (loss) add(fx.id!, loss)
    }
  }
  return res
}

/** Расход месяца по конкретной категории (₽, с возвратами): для лимитов подкатегорий. */
export function spentByCategory(txs: Tx[], month: string): Map<number, number> {
  const res = new Map<number, number>()
  for (const t of txs) {
    if ((t.type !== 'expense' && t.type !== 'refund') || t.categoryId == null || monthOf(t.date) !== month) continue
    res.set(t.categoryId, (res.get(t.categoryId) ?? 0) + spendRub(t))
  }
  return res
}

/** Запись лимита, действующая в месяце: последняя с month <= данного. */
function limitRecord(limits: Limit[], categoryId: number, month: string): Limit | undefined {
  let best: Limit | undefined
  for (const l of limits) {
    if (l.categoryId === categoryId && l.month <= month && (!best || l.month > best.month)) best = l
  }
  return best
}

/** Лимит конверта в месяце (0 — нет лимита или лимит 0 ₽; различает `hasLimit` у конверта). */
export function limitFor(limits: Limit[], categoryId: number, month: string): number {
  return limitRecord(limits, categoryId, month)?.amount ?? 0
}

export interface Envelope {
  category: Category
  limit: number
  /** Лимит задан (в том числе явно 0 ₽). Без лимита — false. */
  hasLimit: boolean
  spent: number
  available: number // limit − spent; каждый месяц конверт начинается заново, без переноса
}

/** Состояние конвертов в месяце. Лимит действует, пока не изменён; остаток и перерасход в следующий месяц не переходят. */
export function envelopes(categories: Category[], limits: Limit[], txs: Tx[], month: string): Envelope[] {
  const spent = spentByEnvelope(categories, txs, month)
  // Только расходные; архивные — если в месяце по ним были траты (история не теряется).
  const roots = categories.filter(c => c.parentId == null && (c.kind ?? 'expense') === 'expense' && (!c.archived || spent.has(c.id!)))
  return roots.map(category => {
    const rec = limitRecord(limits, category.id!, month)
    const limit = rec?.amount ?? 0
    const s = spent.get(category.id!) ?? 0
    return { category, limit, hasLimit: !!rec && (rec.amount > 0 || !!rec.strict), spent: s, available: limit - s }
  })
}

/**
 * Подкатегории конверта: собственный расход каждой и её лимит. Плюс строка «без подкатегории» —
 * траты прямо в основной категории. Лимиты подкатегорий — детализация бюджета родителя, а не добавка к нему.
 */
export function subEnvelopes(categories: Category[], limits: Limit[], txs: Tx[], month: string, rootId: number): Envelope[] {
  const spent = spentByCategory(txs, month)
  return categories
    .filter(c => c.parentId === rootId && (!c.archived || spent.has(c.id!)))
    .map(category => {
      const rec = limitRecord(limits, category.id!, month)
      const limit = rec?.amount ?? 0
      const s = spent.get(category.id!) ?? 0
      return { category, limit, hasLimit: !!rec && (rec.amount > 0 || !!rec.strict), spent: s, available: limit - s }
    })
}

/** Бюджет основной категории: её собственный лимит, а если его нет — сумма лимитов подкатегорий. */
export function envelopePlan(env: Envelope, subs: Envelope[]): { limit: number; hasLimit: boolean; fromSubs: boolean } {
  if (env.hasLimit) return { limit: env.limit, hasLimit: true, fromSubs: false }
  const withLimit = subs.filter(x => x.hasLimit)
  return withLimit.length ? { limit: withLimit.reduce((s, x) => s + x.limit, 0), hasLimit: true, fromSubs: true } : { limit: 0, hasLimit: false, fromSubs: false }
}

// ---------- Движение денег (не потребительские расходы) ----------

export interface Movements {
  /** Переведено в копилки и на вклады (минус выведено обратно). */
  saved: number
  /** Переведено на брокерские счета (минус выведено). */
  invested: number
  /** Погашено долгов: перевод на счёт-кредит (основной долг; проценты — отдельным расходом). */
  repaid: number
  /** Получено в кредит или в долг: перевод со счёта-кредита. */
  borrowed: number
  /** Выдано в долг и возвращено мне. */
  lent: number
  returned: number
}

/** Перемещения между своими счетами за период — отдельно от доходов и расходов. */
export function movements(accounts: Account[], txs: Tx[], from: string, to: string): Movements {
  const kind = new Map(accounts.map(a => [a.id!, accountKind(a)]))
  const r: Movements = { saved: 0, invested: 0, repaid: 0, borrowed: 0, lent: 0, returned: 0 }
  for (const t of txs) {
    const m = monthOf(t.date)
    if (t.type !== 'transfer' || m < from || m > to) continue
    const a = kind.get(t.accountId), b = kind.get(t.toAccountId!)
    const v = t.toRub ?? t.rub
    if (b === 'credit') r.repaid += v
    if (a === 'credit') r.borrowed += t.rub
    if (b === 'debt') r.lent += v
    if (a === 'debt') r.returned += t.rub
    if (b === 'savings' && a !== 'savings') r.saved += v
    if (a === 'savings' && b !== 'savings') r.saved -= t.rub
    if (b === 'broker' && a !== 'broker') r.invested += v
    if (a === 'broker' && b !== 'broker') r.invested -= t.rub
  }
  return r
}

// ---------- Рекомендация при поступлении ----------

export interface Reserve {
  recurring: Recurring
  rub: number
}

export interface Distribution {
  income: number
  /** Отложить на регулярные платежи и пополнения, привязанные к этой выплате. */
  reserves: Reserve[]
  /** Отложить на цели. */
  goals: { goal: Goal; rub: number }[]
  /** Остаётся свободным. */
  free: number
}

/**
 * Что сделать с поступлением. Зарплата и аванс: сначала резервы на привязанные к выплате платежи
 * и пополнения копилок, затем месячный план целей со сроком, остальное свободно.
 * Нерегулярные деньги (премия, от родителей, проценты) — на цели по приоритету.
 */
export function suggestDistribution(
  tx: Tx,
  /** goalRemainingRub — сколько рублей осталось до каждой цели; goalMonthLeftRub — сколько ещё нужно в этом месяце целям со сроком. */
  data: { recurring: Recurring[]; goals: Goal[]; goalRemainingRub: Map<number, number>; goalMonthLeftRub?: Map<number, number> },
  recurringToRub: (r: Recurring) => number,
): Distribution {
  const kind = tx.incomeKind as IncomeKind
  const income = tx.rub
  const regular = REGULAR_INCOME.includes(kind)
  const reserves: Reserve[] = regular
    ? data.recurring
      .filter(r => r.active && (r.fundFrom === kind || r.fundFrom === 'both'))
      .map(r => { const full = recurringToRub(r); return { recurring: r, rub: r.fundFrom === 'both' ? Math.round(full / 2) : full } })
    : []
  const left = Math.max(0, income - reserves.reduce((s, r) => s + r.rub, 0))
  const goals = suggestGoals(left, data.goals, data.goalRemainingRub, data.goalMonthLeftRub, regular)
  return { income, reserves, goals, free: left - goals.reduce((s, g) => s + g.rub, 0) }
}

export function suggestGoals(
  savings: number,
  goals: Goal[],
  remainingRub: Map<number, number>,
  monthLeftRub: Map<number, number> = new Map(),
  /** Только месячный план целей со сроком (для зарплаты и аванса). */
  deadlinesOnly = false,
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
  if (!deadlinesOnly) for (const g of sorted) give(g, Infinity)
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

// ---------- Главная, календарь, аналитика ----------

/** Доходы и расходы за месяц (₽). Разница курса при обмене считается расходом. */
export function monthTotals(txs: Tx[], month: string): { income: number; expense: number } {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'income') income += t.rub
    else expense += spendRub(t)
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
    if (t.type === 'income' || t.type === 'adjust') s += t.rub
    else s -= spendRub(t)
  }
  return s
}

/** Название планового события для списков. */
export const eventTitle = (e: PlannedEvent) => e.kind === 'payment' ? e.recurring.name : e.kind === 'extra' ? e.name : e.kind === 'salary' ? 'Зарплата' : 'Аванс'

export type PlannedEvent =
  | { date: string; kind: 'payment'; recurring: Recurring }
  | { date: string; kind: 'salary' | 'advance'; amount: number }
  | { date: string; kind: 'extra'; name: string; amount: number; premium: boolean; detail: string }

const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate()
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Плановые события месяца: регулярные платежи и дни выплат. День 31 в коротком месяце — последний день. */
export function plannedInMonth(recurring: Recurring[], settings: Settings, month: string): PlannedEvent[] {
  const [y, m] = month.split('-').map(Number)
  const day = (d: number) => iso(y, m, Math.min(d, daysIn(y, m)))
  const events: PlannedEvent[] = [
    { date: day(settings.salaryDay), kind: 'salary', amount: expectedPay(settings, 'salary', day(settings.salaryDay)) },
    { date: day(settings.advanceDay), kind: 'advance', amount: expectedPay(settings, 'advance', day(settings.advanceDay)) },
    ...extrasForMonth(settings, month).map(x => ({ date: x.date, kind: 'extra' as const, name: x.name, amount: x.amount, premium: x.premium, detail: x.detail })),
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
  if (r.paidMonths?.includes(month)) return true // отмечен вручную, без операции
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
    } else variable += t.type === 'refund' ? -t.rub : t.type === 'transfer' ? fxLoss(t) : 0
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
      else if (t.type === 'refund') v -= t.rub
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
  const ev = (k: 'salary' | 'advance') => plannedInMonth([], settings, month).find(e => e.kind === k) as { amount: number } | undefined
  const extras = plannedInMonth([], settings, month).filter(e => e.kind === 'extra') as Extract<PlannedEvent, { kind: 'extra' }>[]
  const income = totals.income + (got('salary') ? 0 : ev('salary')?.amount ?? 0) + (got('advance') ? 0 : ev('advance')?.amount ?? 0)
    + extras.filter(e => !extraTx(e, data.txs)).reduce((s, e) => s + e.amount, 0)
  return { income, expense, balance: income - expense, fixedLeft, variablePace }
}

/** Капитал (₽) на конец каждого месяца: стартовые балансы рублёвых счетов + все движения до конца месяца. */
export function capitalByMonth(accounts: Account[], txs: Tx[], months: string[], toRub: (minor: number, a: Account) => number): number[] {
  const opening = accounts.reduce((s, a) => s + toRub(a.openingBalance, a), 0)
  return months.map(m => opening + netChangeSince(txs.filter(t => monthOf(t.date) <= m), '0000-00-00'))
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
  const rank = (a: Account) => ({ card: 0, credit: 1, savings: 2, broker: 3, debt: 4 })[accountKind(a)]
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

export type SetupStep = 'pay' | 'recurring' | 'goals' | 'security' | 'backup'

export function setupSteps(
  d: { settings: Settings; recurring: Recurring[]; goals: Goal[]; accounts?: Account[] },
  lockEnabled: boolean,
): { id: SetupStep; label: string; done: boolean }[] {
  const active = d.recurring.filter(r => r.active)
  return [
    { id: 'pay', label: 'Ожидаемые зарплата и аванс', done: !!d.settings.pay?.gross || (d.settings.expectedSalary > 0 && d.settings.expectedAdvance > 0) },
    { id: 'recurring', label: 'Регулярные платежи с копилками', done: active.length > 0 && active.every(r => r.reserveAccountId != null) },
    { id: 'goals', label: 'Цели на копилках', done: d.goals.length > 0 },
    { id: 'security', label: 'Face ID или PIN', done: lockEnabled },
    { id: 'backup', label: 'Первый бэкап в Excel', done: d.settings.lastExportAt != null },
  ]
}
