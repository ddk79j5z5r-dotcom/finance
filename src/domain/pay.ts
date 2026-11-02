import type { Settings, Tx } from './types'

// ---------- Производственный календарь (пятидневка) ----------

/**
 * Нерабочие будни и рабочие выходные по постановлениям Правительства о переносе выходных.
 * Сверено с производственными календарями КонсультантПлюс на 2026 и 2027 годы.
 * Для других лет — общее правило ТК: праздник в выходной переносится на следующий рабочий день (кроме январских).
 */
const OFFICIAL: Record<number, { off: string[]; work: string[] }> = {
  2026: {
    off: ['01-01', '01-02', '01-05', '01-06', '01-07', '01-08', '01-09', '02-23', '03-09', '05-01', '05-11', '06-12', '11-04', '12-31'],
    work: [],
  },
  2027: {
    off: ['01-01', '01-04', '01-05', '01-06', '01-07', '01-08', '02-22', '02-23', '03-08', '05-03', '05-10', '06-14', '11-04', '11-05', '12-31'],
    work: ['02-20'],
  },
}

/** Нерабочие праздничные дни (ст. 112 ТК РФ). */
const HOLIDAYS = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04']

const pad = (n: number) => String(n).padStart(2, '0')

/** Нерабочие будни года по общему правилу: праздники плюс переносы с выходных (январские не переносятся). */
function genericOff(year: number): Set<string> {
  const off = new Set<string>()
  for (const md of HOLIDAYS) {
    const d = new Date(year, Number(md.slice(0, 2)) - 1, Number(md.slice(3)))
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) { off.add(md); continue }
    if (md.startsWith('01-')) continue
    const next = new Date(d)
    do next.setDate(next.getDate() + 1)
    while (next.getDay() === 0 || next.getDay() === 6 || HOLIDAYS.includes(`${pad(next.getMonth() + 1)}-${pad(next.getDate())}`))
    off.add(`${pad(next.getMonth() + 1)}-${pad(next.getDate())}`)
  }
  return off
}

/** Есть ли для года официальный календарь (иначе расчёт по общему правилу — может разойтись с постановлением). */
export const hasOfficialCalendar = (year: number) => year in OFFICIAL

export function isWorkday(date: Date): boolean {
  const y = date.getFullYear()
  const md = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const cal = OFFICIAL[y]
  if (cal?.work.includes(md)) return true
  const wd = date.getDay()
  if (wd === 0 || wd === 6) return false
  return !(cal ? cal.off.includes(md) : genericOff(y).has(md))
}

/** Рабочие дни месяца YYYY-MM с дня `from` по день `to` включительно. */
export function workdays(month: string, from = 1, to = 31): number {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  let n = 0
  for (let d = from; d <= Math.min(to, last); d++) if (isWorkday(new Date(y, m - 1, d))) n++
  return n
}

// ---------- Аванс и зарплата по окладу ----------

/** Аванс — за первую половину месяца (1–15 число), как в калькуляторе ipipip.ru/kz. */
export const ADVANCE_LAST_DAY = 15

export interface PayCalc {
  /** За какой месяц начисление. */
  month: string
  base: number      // оклад + надбавки — от них считается аванс (копейки)
  premium: number   // премия, приходящая с зарплатой (до НДФЛ)
  other: number     // другие выплаты с зарплатой, облагаемые НДФЛ
  untaxed: number   // другие выплаты с зарплатой без налога (на руки)
  accrued: number   // начислено за месяц, облагаемое: оклад + премия + надбавки + другое
  days: number      // рабочих дней в месяце
  halfDays: number  // рабочих дней с 1 по 15
  advanceGross: number
  advanceTax: number
  advance: number   // аванс на руки
  tax: number       // НДФЛ за месяц
  net: number       // на руки за месяц
  rest: number      // остаток после аванса — «зарплата»
}

/** НДФЛ считается в целых рублях (п. 6 ст. 52 НК РФ). */
const tax = (base: number, rate: number) => Math.round(Math.max(0, base) * rate / 100 / 100) * 100

const premiumGross = (pay: NonNullable<Settings['pay']>) =>
  !pay.premium || pay.premium.value <= 0 ? 0 : pay.premium.mode === 'percent' ? Math.round((pay.gross * pay.premium.value) / 100) : pay.premium.value

/**
 * Расчёт месяца как в калькуляторе ipipip.ru/kz.
 * Аванс = (оклад + надбавки) × рабочие дни с 1 по 15 ÷ рабочие дни месяца − НДФЛ с этой суммы.
 * За месяц: оклад + премия + надбавки + другие выплаты − НДФЛ со всего (с учётом вычетов) = на руки;
 * зарплата (остаток) = на руки − аванс. Премия и другие выплаты «с зарплатой» приходят в остатке.
 */
export function payForMonth(pay: NonNullable<Settings['pay']>, month: string): PayCalc {
  const base = pay.gross + pay.bonus
  const premium = pay.premium?.day ? 0 : premiumGross(pay)
  const withSalary = (pay.extras ?? []).filter(x => !x.day && x.amount > 0)
  const other = withSalary.filter(x => x.taxed).reduce((s, x) => s + x.amount, 0)
  const untaxed = withSalary.filter(x => !x.taxed).reduce((s, x) => s + x.amount, 0)
  const accrued = base + premium + other
  const days = workdays(month)
  const halfDays = workdays(month, 1, ADVANCE_LAST_DAY)
  const advanceGross = days ? Math.round((base * halfDays) / days) : 0
  const advanceTax = tax(advanceGross, pay.rate)
  const monthTax = tax(accrued - pay.deduction, pay.rate)
  const advance = advanceGross - advanceTax
  const net = accrued - monthTax + untaxed
  return { month, base, premium, other, untaxed, accrued, days, halfDays, advanceGross, advanceTax, advance, tax: monthTax, net, rest: net - advance }
}

const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}

/**
 * За какой месяц выплата. Аванс — всегда за первую половину месяца, в котором его платят.
 * Зарплата — остаток за месяц: если она приходит раньше аванса (зарплата 13-го, аванс 28-го) — за прошлый месяц,
 * если позже (аванс 13-го, зарплата 28-го) — за текущий.
 */
export function payMonthFor(kind: 'salary' | 'advance', date: string, settings: Pick<Settings, 'salaryDay' | 'advanceDay'>) {
  const month = date.slice(0, 7)
  return kind === 'salary' && settings.salaryDay < settings.advanceDay ? prevMonth(month) : month
}

/** Ожидаемая сумма выплаты на дату: по окладу, если он задан, иначе — введённая вручную. */
export function expectedPay(settings: Settings, kind: 'salary' | 'advance', date: string): number {
  const pay = settings.pay
  if (!pay?.gross) {
    if (kind === 'advance') return settings.expectedAdvance
    if (!pay) return settings.expectedSalary
    // Без оклада: к зарплате, введённой вручную, прибавляются премия и выплаты «с зарплатой» за вычетом НДФЛ.
    const c = payForMonth(pay, payMonthFor(kind, date, settings))
    const extra = c.premium + c.other
    return settings.expectedSalary + extra - tax(extra, pay.rate) + c.untaxed
  }
  const c = payForMonth(pay, payMonthFor(kind, date, settings))
  return kind === 'advance' ? c.advance : c.rest
}

// ---------- Премия и другие выплаты ----------

export interface ExtraPay {
  date: string
  name: string
  amount: number // на руки
  premium: boolean
  gross: number
  tax: number
  /** Как посчитано — для расшифровки. */
  detail: string
}

const rub = (v: number) => `${Math.round(v / 100).toLocaleString('ru-RU')} ₽`

/** Премия и другие выплаты месяца YYYY-MM с датами и суммами на руки. */
export function extrasForMonth(settings: Settings, month: string): ExtraPay[] {
  const pay = settings.pay
  if (!pay) return []
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const at = (d: number) => `${month}-${pad(Math.min(Math.max(1, d), last))}`
  const res: ExtraPay[] = []
  // Выплаты «с зарплатой» входят в её сумму (payForMonth); отдельной точкой — только со своим днём.
  const p = pay.premium
  if (p?.day && p.value > 0) {
    const gross = premiumGross(pay)
    const t = tax(gross, pay.rate)
    res.push({
      date: at(p.day), name: 'Премия', premium: true, gross, tax: t, amount: gross - t,
      detail: `${p.mode === 'percent' ? `${p.value}% от оклада ${rub(pay.gross)} = ` : ''}${rub(gross)} − НДФЛ ${rub(t)}`,
    })
  }
  for (const x of pay.extras ?? []) {
    if (!x.day || !x.amount || !x.name.trim()) continue
    const t = x.taxed ? tax(x.amount, pay.rate) : 0
    res.push({ date: at(x.day), name: x.name.trim(), premium: false, gross: x.amount, tax: t, amount: x.amount - t, detail: x.taxed ? `${rub(x.amount)} − НДФЛ ${rub(t)}` : 'без налога' })
  }
  return res
}

/** Пришла ли доп. выплата: доход в её месяце с тем же названием (премия — ещё и по виду «премия»). */
export function extraTx(e: { date: string; name: string; premium: boolean }, txs: Tx[]): Tx | undefined {
  const month = e.date.slice(0, 7)
  const name = e.name.toLocaleLowerCase('ru')
  return txs.find(t => t.type === 'income' && t.date.slice(0, 7) === month &&
    ((e.premium && t.incomeKind === 'bonus') || t.comment.trim().toLocaleLowerCase('ru') === name))
}

// ---------- Прогноз поступлений месяца по строкам ----------

export interface IncomeItem {
  key: string
  kind: 'salary' | 'advance' | 'premium' | 'extra'
  name: string
  amount: number // на руки
  /** Расшифровка: «Начислено», «Налог», «Выплаченный аванс». */
  lines: { label: string; value: number }[]
  note?: string
}

export interface IncomeDay { date: string; total: number; items: IncomeItem[] }

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/**
 * Поступления месяца по дням и строкам. Зарплата раскладывается на саму зарплату, премию и выплаты «с зарплатой»;
 * сумма строк дня равна расчёту payForMonth (НДФЛ со всего начисления), поэтому прогноз и шкала совпадают.
 */
export function incomeForecast(settings: Settings, month: string): IncomeDay[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const at = (d: number) => `${month}-${pad(Math.min(Math.max(1, d), last))}`
  const pay = settings.pay
  const items: (IncomeItem & { date: string })[] = []

  const salaryDate = at(settings.salaryDay), advanceDate = at(settings.advanceDay)
  const c = pay ? payForMonth(pay, payMonthFor('salary', salaryDate, settings)) : null
  // Премия и выплаты «с зарплатой» — отдельными строками, налог на каждую — своей долей.
  const withSalary: IncomeItem[] = []
  if (pay && c) {
    if (c.premium) {
      const t = tax(c.premium, pay.rate)
      const p = pay.premium!
      withSalary.push({ key: 'premium', kind: 'premium', name: 'Премия', amount: c.premium - t, lines: [{ label: 'Начислено', value: c.premium }, { label: 'Налог', value: -t }], note: p.mode === 'percent' ? `${p.value}% от оклада` : undefined })
    }
    for (const [i, x] of (pay.extras ?? []).entries()) {
      if (x.day || !x.amount || !x.name.trim()) continue
      const t = x.taxed ? tax(x.amount, pay.rate) : 0
      withSalary.push({ key: `x${i}`, kind: 'extra', name: x.name.trim(), amount: x.amount - t, lines: x.taxed ? [{ label: 'Начислено', value: x.amount }, { label: 'Налог', value: -t }] : [], note: x.taxed ? undefined : 'без налога' })
    }
  }
  const salaryTotal = expectedPay(settings, 'salary', salaryDate)
  const extrasNet = withSalary.reduce((s, x) => s + x.amount, 0)
  if (salaryTotal > 0) {
    const own = salaryTotal - extrasNet
    const lines = pay?.gross && c
      ? [{ label: 'Начислено', value: c.base }, { label: 'Налог', value: -(c.tax - withSalary.reduce((s, x) => s - (x.lines.find(l => l.label === 'Налог')?.value ?? 0), 0)) }, { label: 'Выплаченный аванс', value: -c.advance }]
      : []
    items.push({ date: salaryDate, key: 'salary', kind: 'salary', name: 'Зарплата', amount: own, lines, note: c && pay?.gross ? `за ${['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][Number(c.month.slice(5)) - 1]}` : undefined })
    for (const x of withSalary) items.push({ ...x, date: salaryDate })
  }

  const advance = expectedPay(settings, 'advance', advanceDate)
  if (advance > 0) {
    const a = pay?.gross ? payForMonth(pay, payMonthFor('advance', advanceDate, settings)) : null
    items.push({
      date: advanceDate, key: 'advance', kind: 'advance', name: 'Аванс', amount: advance,
      lines: a ? [{ label: 'Начислено', value: a.advanceGross }, { label: 'Налог', value: -a.advanceTax }] : [],
      note: a ? `за 1–${ADVANCE_LAST_DAY} ${MONTH_GEN[Number(a.month.slice(5)) - 1]}, ${a.halfDays} из ${a.days} раб. дн.` : undefined,
    })
  }

  for (const [i, x] of extrasForMonth(settings, month).entries()) {
    items.push({ date: x.date, key: `e${i}`, kind: x.premium ? 'premium' : 'extra', name: x.name, amount: x.amount, lines: x.tax ? [{ label: 'Начислено', value: x.gross }, { label: 'Налог', value: -x.tax }] : [], note: x.tax ? undefined : 'без налога' })
  }

  const days = new Map<string, IncomeDay>()
  for (const it of items.sort((a, b) => a.date.localeCompare(b.date))) {
    const d = days.get(it.date) ?? { date: it.date, total: 0, items: [] }
    d.total += it.amount
    d.items.push(it)
    days.set(it.date, d)
  }
  return [...days.values()]
}
