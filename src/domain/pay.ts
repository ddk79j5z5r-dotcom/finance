import type { Settings, Tx } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

// ---------- Аванс и зарплата по окладу ----------

export interface PayCalc {
  /** За какой месяц начисление. */
  month: string
  accrued: number   // начислено за месяц: оклад + надбавки (копейки)
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
 * Расчёт месяца по окладу. Аванс = половина оклада − НДФЛ с неё;
 * зарплата (остаток) = оклад + надбавки − НДФЛ за месяц (с учётом вычетов) − аванс на руки.
 */
export function payForMonth(pay: NonNullable<Settings['pay']>, month: string): PayCalc {
  const accrued = pay.gross + pay.bonus
  const advanceGross = Math.round(pay.gross / 2)
  const advanceTax = tax(advanceGross, pay.rate)
  const monthTax = tax(accrued - pay.deduction, pay.rate)
  const advance = advanceGross - advanceTax
  const net = accrued - monthTax
  return { month, accrued, advanceGross, advanceTax, advance, tax: monthTax, net, rest: net - advance }
}

const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}

/**
 * За какой месяц выплата. Аванс — всегда за месяц, в котором его платят.
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
