import { describe, expect, it } from 'vitest'
import {
  allocationOf, balances, bucketStates, envelopes, goalProgress, planIncome, suggestDistribution, suggestGoals,
} from './calc'
import { formatMoney, parseAmount } from './money'
import type { Account, Allocation, Category, Goal, Limit, Recurring, Tx } from './types'
import { DEFAULT_SETTINGS } from './types'

const R = (rub: number) => rub * 100
let nextId = 1
const tx = (p: Partial<Tx>): Tx => ({
  id: nextId++, date: '2026-10-01', type: 'expense', accountId: 1, amount: 0, rub: 0, comment: '', createdAt: 0, ...p,
})

describe('деньги', () => {
  it('разбирает ввод', () => {
    expect(parseAmount('1 234,5')).toBe(123450)
    expect(parseAmount('99.99')).toBe(9999)
    expect(parseAmount('12,345')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
  it('форматирует', () => {
    expect(formatMoney(1250000)).toBe('12 500 ₽')
    expect(formatMoney(120050, 'USD')).toBe('1 200,50 $')
    expect(formatMoney(-500)).toBe('−5 ₽')
  })
})

describe('балансы', () => {
  it('учитывает расход, доход, перевод и обмен валюты', () => {
    const accounts: Account[] = [
      { id: 1, name: 'Карта', currency: 'RUB', openingBalance: R(10000), archived: false, order: 0 },
      { id: 2, name: 'Доллары', currency: 'USD', openingBalance: 0, archived: false, order: 1 },
    ]
    const b = balances(accounts, [
      tx({ type: 'income', amount: R(50000), rub: R(50000) }),
      tx({ type: 'expense', amount: R(1500), rub: R(1500) }),
      // купил $100 за 9 500 ₽
      tx({ type: 'transfer', amount: R(9500), rub: R(9500), toAccountId: 2, toAmount: R(100), toRub: R(9200) }),
    ])
    expect(b.get(1)).toBe(R(49000))
    expect(b.get(2)).toBe(R(100))
  })
})

const cats: Category[] = [
  { id: 1, name: 'Жильё', parentId: null, bucket: 'needs', archived: false },
  { id: 2, name: 'Аренда', parentId: 1, bucket: 'needs', archived: false },
  { id: 3, name: 'Кафе', parentId: null, bucket: 'wants', archived: false },
  { id: 4, name: 'Кредиты', parentId: null, bucket: 'needs', archived: false },
  { id: 9, name: 'Разница курса', parentId: null, bucket: 'needs', archived: false, system: 'fx' },
]

describe('конверты', () => {
  const limits: Limit[] = [{ categoryId: 3, month: '2026-09', amount: R(10000) }]
  const env = (txs: Tx[], month: string) => envelopes(cats, limits, txs, month).find(e => e.category.id === 3)!

  it('переносит остаток на следующий месяц', () => {
    const e = env([tx({ date: '2026-09-10', categoryId: 3, amount: R(7000), rub: R(7000) })], '2026-10')
    expect(e).toMatchObject({ limit: R(10000), carry: R(3000), available: R(13000) })
  })
  it('переносит и перерасход', () => {
    const e = env([tx({ date: '2026-09-10', categoryId: 3, amount: R(12000), rub: R(12000) })], '2026-10')
    expect(e.carry).toBe(R(-2000))
    expect(e.available).toBe(R(8000))
  })
  it('трата в подкатегории идёт в конверт родителя', () => {
    const e = envelopes(cats, [], [tx({ date: '2026-10-01', categoryId: 2, amount: R(30000), rub: R(30000) })], '2026-10')
    expect(e.find(x => x.category.id === 1)!.spent).toBe(R(30000))
  })
  it('разница курса при обмене попадает в служебный конверт', () => {
    const e = envelopes(cats, [], [tx({ type: 'transfer', date: '2026-10-02', amount: R(9500), rub: R(9500), toAccountId: 2, toAmount: R(100), toRub: R(9200) })], '2026-10')
    expect(e.find(x => x.category.id === 9)!.spent).toBe(R(300))
  })
})

describe('распределение поступлений (реальный сценарий)', () => {
  const settings = { ...DEFAULT_SETTINGS, expectedSalary: R(60000), expectedAdvance: R(60000) }
  const recurring: Recurring[] = [
    { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 2, fundFrom: 'salary', active: true },
    { id: 2, name: 'Кредит', amount: R(20000), currency: 'RUB', day: 29, categoryId: 4, fundFrom: 'advance', active: true },
  ]
  const goals: Goal[] = [
    { id: 1, name: 'Подушка', target: R(300000), accountId: 5, priority: 0 },
    { id: 2, name: 'Отпуск', target: R(100000), accountId: 5, priority: 1 },
  ]
  const goalRemainingRub = new Map([[1, R(10000)], [2, R(100000)]])
  const run = (income: Tx, txs: Tx[], allocations: Allocation[]) =>
    suggestDistribution(income, { txs, allocations, recurring, goals, goalRemainingRub }, settings, r => r.amount)

  it('весь месяц приходит к 50/30/20, резервы — из своих выплат', () => {
    const txs: Tx[] = []
    const allocations: Allocation[] = []
    const receive = (p: Partial<Tx>) => {
      const t = tx({ type: 'income', ...p })
      txs.push(t)
      const d = run(t, txs, allocations)
      allocations.push({ txId: t.id!, month: '2026-10', ...allocationOf(d) })
      return d
    }

    const salary = receive({ date: '2026-10-13', incomeKind: 'salary', amount: R(60000), rub: R(60000) })
    expect(salary.reserves.map(r => r.recurring.name)).toEqual(['Аренда'])
    expect(salary.split).toEqual({ needs: R(10000), wants: R(12000), savings: R(8000) })

    const advance = receive({ date: '2026-10-28', incomeKind: 'advance', amount: R(60000), rub: R(60000) })
    expect(advance.reserves.map(r => r.recurring.name)).toEqual(['Кредит'])
    expect(advance.split).toEqual({ needs: 0, wants: R(24000), savings: R(16000) })

    const month = () => allocations.reduce((s, a) => ({ needs: s.needs + a.needs, wants: s.wants + a.wants, savings: s.savings + a.savings }), { needs: 0, wants: 0, savings: 0 })
    expect(month()).toEqual({ needs: R(60000), wants: R(36000), savings: R(24000) })

    // Премия расширяет месяц по тем же пропорциям
    const bonus = receive({ date: '2026-10-20', incomeKind: 'bonus', amount: R(20000), rub: R(20000) })
    expect(bonus.split).toEqual({ needs: R(10000), wants: R(6000), savings: R(4000) })
    expect(month()).toEqual({ needs: R(70000), wants: R(42000), savings: R(28000) })
  })

  it('перевод от родителей по умолчанию целиком в сбережения, по целям в порядке приоритета', () => {
    const gift = tx({ type: 'income', date: '2026-10-05', incomeKind: 'gift', amount: R(15000), rub: R(15000) })
    const d = run(gift, [gift], [])
    expect(d.reserves).toEqual([])
    expect(d.split).toEqual({ needs: 0, wants: 0, savings: R(15000) })
    expect(d.goalSuggestions.map(s => [s.goal.name, s.rub])).toEqual([['Подушка', R(10000)], ['Отпуск', R(5000)]])
  })

  it('подарки не входят в базу правила, ожидаемая зарплата — входит, пока не пришла', () => {
    const gift = tx({ type: 'income', date: '2026-10-05', incomeKind: 'gift', amount: R(15000), rub: R(15000) })
    expect(planIncome([gift], '2026-10', settings)).toBe(R(120000))
    const salary = tx({ type: 'income', date: '2026-10-13', incomeKind: 'salary', amount: R(65000), rub: R(65000) })
    expect(planIncome([gift, salary], '2026-10', settings)).toBe(R(125000))
  })

  it('сумма сбережений по факту — переводы на счёт целей', () => {
    const s = bucketStates({
      categories: cats, limits: [], allocations: [], goals,
      txs: [tx({ type: 'transfer', date: '2026-10-14', accountId: 1, amount: R(8000), rub: R(8000), toAccountId: 5, toAmount: R(8000), toRub: R(8000) })],
    }, '2026-10', settings)
    expect(s.savings.spent).toBe(R(8000))
  })
})

describe('цели', () => {
  it('баланс счёта заполняет цели по приоритету', () => {
    const goals: Goal[] = [
      { id: 2, name: 'Отпуск', target: R(100000), accountId: 5, priority: 1 },
      { id: 1, name: 'Подушка', target: R(300000), accountId: 5, priority: 0 },
    ]
    const p = goalProgress(goals, new Map([[5, R(350000)]]))
    expect(p.map(x => [x.goal.name, x.saved, x.remaining])).toEqual([
      ['Подушка', R(300000), 0],
      ['Отпуск', R(50000), R(50000)],
    ])
  })
  it('подсказки пропускают закрытые цели', () => {
    const goals: Goal[] = [{ id: 1, name: 'A', target: 1, accountId: 1, priority: 0 }, { id: 2, name: 'B', target: 1, accountId: 1, priority: 1 }]
    expect(suggestGoals(500, goals, new Map([[1, 0], [2, 1000]])).map(s => s.goal.name)).toEqual(['B'])
  })
})

import { monthAverage, monthTotals, netChangeSince, plannedInMonth, spendByRoot, upcoming } from './calc'

describe('главная и календарь', () => {
  const settings = { ...DEFAULT_SETTINGS, expectedSalary: R(60000), expectedAdvance: R(60000) }
  const recurring: Recurring[] = [
    { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 2, fundFrom: 'salary', active: true },
    { id: 2, name: 'Кредит', amount: R(20000), currency: 'RUB', day: 29, categoryId: 4, fundFrom: 'advance', active: true },
    { id: 3, name: 'Старое', amount: R(1), currency: 'RUB', day: 31, categoryId: 4, fundFrom: 'advance', active: false },
    { id: 4, name: 'В конце', amount: R(500), currency: 'RUB', day: 31, categoryId: 4, fundFrom: 'advance', active: true },
  ]

  it('день 31 в феврале — последний день месяца, неактивные не показываются', () => {
    const ev = plannedInMonth(recurring, settings, '2027-02')
    expect(ev.map(e => [e.date, e.kind === 'payment' ? e.recurring.name : e.kind])).toEqual([
      ['2027-02-01', 'Аренда'], ['2027-02-13', 'salary'], ['2027-02-28', 'advance'], ['2027-02-28', 'Кредит'], ['2027-02-28', 'В конце'],
    ])
  })

  it('ближайшие события переходят через границу месяца', () => {
    const ev = upcoming(recurring, settings, '2026-09-29', 14)
    expect(ev.map(e => [e.date, e.kind === 'payment' ? e.recurring.name : e.kind])).toEqual([
      ['2026-09-29', 'Кредит'], ['2026-09-30', 'В конце'], ['2026-10-01', 'Аренда'], ['2026-10-13', 'salary'],
    ])
  })

  it('итоги месяца, среднее и изменение капитала', () => {
    const txs = [
      tx({ date: '2026-07-13', type: 'income', incomeKind: 'salary', amount: R(100000), rub: R(100000) }),
      tx({ date: '2026-07-20', categoryId: 3, amount: R(40000), rub: R(40000) }),
      tx({ date: '2026-08-20', categoryId: 3, amount: R(20000), rub: R(20000) }),
      tx({ date: '2026-09-02', type: 'transfer', amount: R(9500), rub: R(9500), toAccountId: 2, toAmount: R(100), toRub: R(9200) }),
    ]
    expect(monthTotals(txs, '2026-09')).toEqual({ income: 0, expense: R(300) })
    expect(monthAverage(txs, '2026-09')).toEqual({ income: R(50000), expense: R(30000) })
    expect(monthAverage(txs, '2026-01')).toBeNull()
    expect(netChangeSince(txs, '2026-08-01')).toBe(-R(20300))
  })

  it('структура расходов за период', () => {
    const txs = [
      tx({ date: '2026-08-20', categoryId: 3, amount: R(20000), rub: R(20000) }),
      tx({ date: '2026-09-01', categoryId: 2, amount: R(30000), rub: R(30000) }),
      tx({ date: '2026-09-05', categoryId: 3, amount: R(5000), rub: R(5000) }),
    ]
    expect(spendByRoot(cats, txs, '2026-09', '2026-09').map(x => [x.category.name, x.rub])).toEqual([['Жильё', R(30000)], ['Кафе', R(5000)]])
    expect(spendByRoot(cats, txs, '2026-08', '2026-09').map(x => [x.category.name, x.rub])).toEqual([['Жильё', R(30000)], ['Кафе', R(25000)]])
  })
})
