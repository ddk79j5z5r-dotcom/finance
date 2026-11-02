import { describe, expect, it } from 'vitest'
import { isPaid, plannedInMonth } from './calc'
import { expectedPay, payForMonth, payMonthFor, workdays } from './pay'
import { DEFAULT_SETTINGS, type Recurring } from './types'

const R = (rub: number) => rub * 100

describe('производственный календарь', () => {
  it('рабочие дни 2026 года совпадают с календарём КонсультантПлюс', () => {
    const months = Array.from({ length: 12 }, (_, i) => workdays(`2026-${String(i + 1).padStart(2, '0')}`))
    expect(months).toEqual([15, 19, 21, 22, 19, 21, 23, 21, 22, 22, 20, 22])
    expect(months.reduce((a, b) => a + b, 0)).toBe(247)
  })

  it('2027: переносы, включая рабочую субботу 20 февраля', () => {
    expect(workdays('2027-01')).toBe(15)
    expect(workdays('2027-02')).toBe(19) // 20 будней − 22 и 23 февраля + суббота 20-го
    expect(workdays('2027-11')).toBe(20) // 4 и 5 ноября
  })

  it('первая половина месяца: 1–15 ноября 2026 — 9 рабочих дней (4-е — праздник)', () => {
    expect(workdays('2026-11', 1, 15)).toBe(9)
  })
})

describe('аванс и зарплата по окладу', () => {
  const pay = { gross: R(130000), bonus: 0, rate: 13, deduction: 0 }

  it('как в калькуляторе: аванс по отработанным дням первой половины, НДФЛ в целых рублях', () => {
    const c = payForMonth(pay, '2026-11')
    expect(c.advanceGross).toBe(R(58500)) // 130 000 × 9 ÷ 20
    expect(c.advanceTax).toBe(R(7605))
    expect(c.advance).toBe(R(50895))
    expect(c.tax).toBe(R(16900))
    expect(c.net).toBe(R(113100))
    expect(c.rest).toBe(R(62205))
    expect(c.advance + c.rest).toBe(c.net)
  })

  it('вычеты уменьшают налог за месяц', () => {
    const c = payForMonth({ ...pay, deduction: R(1400) }, '2026-11')
    expect(c.tax).toBe(R(16718)) // (130 000 − 1 400) × 13% = 16 718
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
    expect(ev.find(e => e.kind === 'advance')).toMatchObject({ amount: R(50895) })
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
