import { describe, expect, it } from 'vitest'
import { isPaid, plannedInMonth } from './calc'
import { expectedPay, extrasForMonth, extraTx, payForMonth, payMonthFor } from './pay'
import { DEFAULT_SETTINGS, type Recurring } from './types'

const R = (rub: number) => rub * 100

describe('аванс и зарплата по окладу', () => {
  const pay = { gross: R(130000), bonus: 0, rate: 13, deduction: 0 }

  it('аванс — половина оклада минус НДФЛ, зарплата — остаток за месяц', () => {
    const c = payForMonth(pay, '2026-11')
    expect(c.advanceGross).toBe(R(65000)) // 130 000 ÷ 2
    expect(c.advanceTax).toBe(R(8450))
    expect(c.advance).toBe(R(56550))
    expect(c.tax).toBe(R(16900))
    expect(c.net).toBe(R(113100))
    expect(c.rest).toBe(R(56550))
    expect(c.advance + c.rest).toBe(c.net)
  })

  it('надбавки — целиком в зарплату, аванс от них не меняется', () => {
    const c = payForMonth({ ...pay, bonus: R(20000) }, '2026-11')
    expect(c.advance).toBe(R(56550))
    expect(c.rest).toBe(R(150000 - 19500 - 56550))
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
    expect(ev.find(e => e.kind === 'advance')).toMatchObject({ amount: R(56550) })
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

  it('премия процентом от оклада — с зарплатой, за вычетом НДФЛ; выплаты — в свои дни', () => {
    const x = extrasForMonth(s, '2026-11')
    expect(x.map(e => [e.name, e.date, e.amount])).toEqual([
      ['Премия', '2026-11-13', R(19500 - 2535)],
      ['Компенсация жилья', '2026-11-05', R(20000)],
      ['Доплата за стаж', '2026-11-28', R(10000 - 1300)],
    ])
  })

  it('выплаты попадают в план каждого месяца и отмечаются полученными по записанному доходу', () => {
    for (const m of ['2026-11', '2026-12', '2027-01']) expect(plannedInMonth([], s, m).filter(e => e.kind === 'extra')).toHaveLength(3)
    const prem = extrasForMonth(s, '2026-11')[0]
    expect(extraTx(prem, [{ id: 1, date: '2026-11-13', type: 'income', incomeKind: 'bonus', accountId: 1, amount: 1, rub: 1, comment: '', createdAt: 0 }])).toBeTruthy()
    expect(extraTx(prem, [])).toBeUndefined()
  })

  it('без оклада премия-сумма и выплаты всё равно считаются', () => {
    const manual = { ...s, pay: { ...s.pay, gross: 0, premium: { mode: 'amount' as const, value: R(5000), day: 20 } } }
    expect(extrasForMonth(manual, '2026-11')[0]).toMatchObject({ date: '2026-11-20', amount: R(5000 - 650) })
    expect(expectedPay({ ...manual, expectedSalary: R(60000) }, 'salary', '2026-11-13')).toBe(R(60000))
  })
})
