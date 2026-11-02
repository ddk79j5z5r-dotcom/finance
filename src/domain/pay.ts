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
  accrued: number   // начислено за месяц: оклад + надбавки (копейки)
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

/**
 * Расчёт месяца по окладу. Аванс = начислено × рабочие дни с 1 по 15 ÷ рабочие дни месяца − НДФЛ с этой суммы;
 * зарплата (остаток) = начислено − НДФЛ за месяц (с учётом вычетов) − аванс на руки.
 */
export function payForMonth(pay: NonNullable<Settings['pay']>, month: string): PayCalc {
  const accrued = pay.gross + pay.bonus
  const days = workdays(month)
  const halfDays = workdays(month, 1, ADVANCE_LAST_DAY)
  const advanceGross = days ? Math.round((accrued * halfDays) / days) : 0
  const advanceTax = tax(advanceGross, pay.rate)
  const monthTax = tax(accrued - pay.deduction, pay.rate)
  const advance = advanceGross - advanceTax
  const net = accrued - monthTax
  return { month, accrued, days, halfDays, advanceGross, advanceTax, advance, tax: monthTax, net, rest: net - advance }
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
  if (!settings.pay?.gross) return kind === 'salary' ? settings.expectedSalary : settings.expectedAdvance
  const c = payForMonth(settings.pay, payMonthFor(kind, date, settings))
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
  const p = pay.premium
  if (p && p.value > 0) {
    const gross = p.mode === 'percent' ? Math.round((pay.gross * p.value) / 100) : p.value
    const t = tax(gross, pay.rate)
    const date = at(p.day || settings.salaryDay)
    res.push({
      date, name: 'Премия', premium: true, gross, tax: t, amount: gross - t,
      detail: `${p.mode === 'percent' ? `${p.value}% от оклада ${rub(pay.gross)} = ` : ''}${rub(gross)} − НДФЛ ${rub(t)}`,
    })
  }
  for (const x of pay.extras ?? []) {
    if (!x.amount || !x.name.trim()) continue
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
