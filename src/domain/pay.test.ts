import { describe, expect, it } from 'vitest'
import { isPaid, plannedInMonth } from './calc'
import { expectedPay, extrasForMonth, extraTx, payForMonth, payMonthFor, workdays } from './pay'
import { DEFAULT_SETTINGS, type Recurring } from './types'

const R = (rub: number) => rub * 100

describe('производственный календарь', () => {
  it('рабочие дни 2026 года совпадают с календарём КонсультантПлюс', () => {
    const months = Array.from({ length: 12 }, (_, i) => workdays(`2026-${String(i + 1).padStart(2, '0')}`))
    expect(months).toEqual([15, 19, 21, 22, 19, 21, 23, 21, 22, 22, 20, 22])
  })
  it('2027: переносы, включая рабочую субботу 20 февраля', () => {
    expect(workdays('2027-02')).toBe(19)
    expect(workdays('2027-11')).toBe(20)
  })
  it('1–15 октября 2026 — 11 рабочих дней, 1–15 ноября — 9', () => {
    expect(workdays('2026-10', 1, 15)).toBe(11)
    expect(workdays('2026-11', 1, 15)).toBe(9)
  })
})

describe('аванс и зарплата по окладу', () => {
  const pay = { gross: R(130000), bonus: 0, rate: 13, deduction: 0 }

  it('пример из калькулятора ipipip.ru за октябрь 2026: оклад, премия, надбавка и другое', () => {
    const c = payForMonth({
      gross: R(132000), bonus: R(50000), rate: 13, deduction: 0,
      premium: { mode: 'amount', value: R(10000), day: 0 },
      extras: [{ name: 'Другое', amount: R(12000), day: 0, taxed: true }],
    }, '2026-10')
    expect(c.accrued).toBe(R(204000))
    expect(c.tax).toBe(R(26520))
    expect(c.net).toBe(R(177480))
    expect(c.advanceGross).toBe(R(91000)) // (132 000 + 50 000) × 11 ÷ 22
    expect(c.advanceTax).toBe(R(11830))
    expect(c.advance).toBe(R(79170))
    expect(c.rest).toBe(R(98310))
  })

  it('вычеты уменьшают налог за месяц', () => {
    expect(payForMonth({ ...pay, deduction: R(1400) }, '2026-11').tax).toBe(R(16718))
  })

  it('аванс — за текущий месяц; зарплата раньше аванса — за прошлый, позже — за текущий', () => {
    const mine = { salaryDay: 13, advanceDay: 28 }, other = { salaryDay: 28, advanceDay: 13 }
    expect(payMonthFor('salary', '2026-11-13', mine)).toBe('2026-10')
    expect(payMonthFor('advance', '2026-11-28', mine)).toBe('2026-11')
    expect(payMonthFor('salary', '2026-01-13', mine)).toBe('2025-12')
    expect(payMonthFor('advance', '2026-11-13', other)).toBe('2026-11')
    expect(payMonthFor('salary', '2026-11-28', other)).toBe('2026-11')
  })

  it('план месяца берёт суммы из расчёта, а без оклада — введённые вручную', () => {
    const s = { ...DEFAULT_SETTINGS, salaryDay: 13, advanceDay: 28, pay }
    const ev = plannedInMonth([], s, '2026-11')
    expect(ev.find(e => e.kind === 'advance')).toMatchObject({ amount: R(50895) }) // 130 000 × 9 ÷ 20 − НДФЛ
    expect(ev.find(e => e.kind === 'salary')).toMatchObject({ amount: payForMonth(pay, '2026-10').rest })
    expect(expectedPay({ ...s, pay: undefined, expectedSalary: R(60000) }, 'salary', '2026-11-13')).toBe(R(60000))
  })
})

describe('отметка оплаты без операции', () => {
  const r: Recurring = { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 5, fundFrom: 'salary', active: true, paidMonths: ['2026-11'] }
  it('платёж оплачен только в отмеченном месяце, операций для этого не нужно', () => {
    expect(isPaid(r, [], '2026-11')).toBe(true)
    expect(isPaid(r, [], '2026-12')).toBe(false)
  })
})

describe('премия и другие выплаты', () => {
  const s = {
    ...DEFAULT_SETTINGS, salaryDay: 13, advanceDay: 28,
    pay: {
      gross: R(130000), bonus: 0, rate: 13, deduction: 0,
      premium: { mode: 'percent' as const, value: 15, day: 0 },
      extras: [{ name: 'Компенсация жилья', amount: R(20000), day: 5, taxed: false }, { name: 'Доплата за стаж', amount: R(10000), day: 28, taxed: true }],
    },
  }

  it('премия и выплаты «с зарплатой» — в её сумме; со своим днём — отдельной точкой', () => {
    expect(extrasForMonth(s, '2026-11').map(e => [e.name, e.date, e.amount])).toEqual([
      ['Компенсация жилья', '2026-11-05', R(20000)],
      ['Доплата за стаж', '2026-11-28', R(10000 - 1300)],
    ])
    const c = payForMonth(s.pay, '2026-10')
    expect(c.premium).toBe(R(19500)) // 15% от 130 000
    expect(c.rest).toBe(c.net - c.advance)
    const sep = { ...s, pay: { ...s.pay, premium: { mode: 'percent' as const, value: 15, day: 20 } } }
    expect(extrasForMonth(sep, '2026-11')[0]).toMatchObject({ name: 'Премия', date: '2026-11-20', amount: R(19500 - 2535) })
  })

  it('выплаты попадают в план каждого месяца и отмечаются полученными по записанному доходу', () => {
    for (const m of ['2026-11', '2026-12', '2027-01']) expect(plannedInMonth([], s, m).filter(e => e.kind === 'extra')).toHaveLength(2)
    const prem = extrasForMonth({ ...s, pay: { ...s.pay, premium: { mode: 'percent' as const, value: 15, day: 20 } } }, '2026-11')[0]
    expect(extraTx(prem, [{ id: 1, date: '2026-11-13', type: 'income', incomeKind: 'bonus', accountId: 1, amount: 1, rub: 1, comment: '', createdAt: 0 }])).toBeTruthy()
    expect(extraTx(prem, [])).toBeUndefined()
  })

  it('без оклада премия-сумма и выплаты всё равно считаются', () => {
    const manual = { ...s, pay: { ...s.pay, gross: 0, extras: [], premium: { mode: 'amount' as const, value: R(5000), day: 20 } } }
    expect(extrasForMonth(manual, '2026-11')[0]).toMatchObject({ date: '2026-11-20', amount: R(5000 - 650) })
    expect(expectedPay({ ...manual, expectedSalary: R(60000) }, 'salary', '2026-11-13')).toBe(R(60000))
    const withSalary = { ...manual, expectedSalary: R(60000), pay: { ...manual.pay, premium: { mode: 'amount' as const, value: R(5000), day: 0 } } }
    expect(expectedPay(withSalary, 'salary', '2026-11-13')).toBe(R(60000 + 5000 - 650))
  })
})
