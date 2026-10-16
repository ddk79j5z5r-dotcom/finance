import { describe, expect, it } from 'vitest'
import { balances, envelopes, goalProgress, suggestDistribution, suggestGoals } from './calc'
import { formatMoney, parseAmount } from './money'
import type { Account, Category, Goal, Limit, Recurring, Tx } from './types'
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

  it('каждый месяц конверт начинается заново: остаток не переносится', () => {
    const e = env([tx({ date: '2026-09-10', categoryId: 3, amount: R(7000), rub: R(7000) })], '2026-10')
    expect(e).toMatchObject({ limit: R(10000), spent: 0, available: R(10000) })
  })
  it('и перерасход не переносится', () => {
    const txs = [tx({ date: '2026-09-10', categoryId: 3, amount: R(12000), rub: R(12000) })]
    expect(env(txs, '2026-09').available).toBe(R(-2000))
    expect(env(txs, '2026-10').available).toBe(R(10000))
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

describe('рекомендация при поступлении', () => {
  const recurring: Recurring[] = [
    { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 2, fundFrom: 'salary', active: true },
    { id: 2, name: 'Кредит', amount: R(20000), currency: 'RUB', day: 29, categoryId: 4, fundFrom: 'advance', active: true },
    { id: 3, kind: 'topup', name: 'Aristo', amount: R(15000), currency: 'RUB', day: 1, categoryId: 2, fundFrom: 'both', reserveAccountId: 40, active: true },
  ]
  const goals: Goal[] = [
    { id: 1, name: 'Подушка', target: R(300000), accountId: 5, priority: 0 },
    { id: 2, name: 'Машина', target: R(100000), accountId: 6, priority: 1, deadline: '2026-12' },
  ]
  const goalRemainingRub = new Map([[1, R(10000)], [2, R(100000)]])
  const goalMonthLeftRub = new Map([[2, R(8000)]])
  const run = (income: Tx) => suggestDistribution(income, { recurring, goals, goalRemainingRub, goalMonthLeftRub }, r => r.amount)

  it('зарплата: резервы своей выплаты и половина общих пополнений, план целей со сроком, остальное свободно', () => {
    const d = run(tx({ type: 'income', date: '2026-10-13', incomeKind: 'salary', amount: R(60000), rub: R(60000) }))
    expect(d.reserves.map(r => [r.recurring.name, r.rub])).toEqual([['Аренда', R(30000)], ['Aristo', R(7500)]])
    expect(d.goals.map(g => [g.goal.name, g.rub])).toEqual([['Машина', R(8000)]])
    expect(d.free).toBe(R(60000 - 30000 - 7500 - 8000))
  })

  it('аванс меньше резервов — свободного нет', () => {
    const d = run(tx({ type: 'income', date: '2026-10-28', incomeKind: 'advance', amount: R(25000), rub: R(25000) }))
    expect(d.reserves.map(r => r.recurring.name)).toEqual(['Кредит', 'Aristo'])
    expect(d.goals).toEqual([])
    expect(d.free).toBe(0)
  })

  it('деньги от родителей — сначала месячный план целей со сроком, потом по приоритету', () => {
    const d = run(tx({ type: 'income', date: '2026-10-05', incomeKind: 'gift', amount: R(15000), rub: R(15000) }))
    expect(d.reserves).toEqual([])
    expect(d.goals.map(g => [g.goal.name, g.rub])).toEqual([['Подушка', R(7000)], ['Машина', R(8000)]])
    expect(d.free).toBe(0)
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

import { capitalByMonth, isPaid, monthForecast, savingsRate } from './calc'

describe('прогноз и копилки', () => {
  const rent: Recurring = { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 2, fundFrom: 'salary', reserveAccountId: 7, active: true }
  const loan: Recurring = { id: 2, name: 'Кредит', amount: R(15300), currency: 'RUB', day: 29, categoryId: 4, fundFrom: 'advance', reserveAccountId: 8, active: true }
  const settings = { ...DEFAULT_SETTINGS, expectedSalary: R(55000), expectedAdvance: R(25000) }

  it('норма сбережений', () => {
    expect(savingsRate({ income: R(100), expense: R(80) })).toBeCloseTo(0.2)
    expect(savingsRate({ income: 0, expense: R(5) })).toBeNull()
  })

  it('платёж считается оплаченным по категории и сумме ±10%', () => {
    const txs = [tx({ date: '2026-10-01', categoryId: 2, amount: R(28000), rub: R(28000) })]
    expect(isPaid(rent, txs, '2026-10')).toBe(true)
    expect(isPaid(rent, txs, '2026-11')).toBe(false)
    expect(isPaid(loan, txs, '2026-10')).toBe(false)
  })

  it('прогноз: фиксированные по плану, переменные по темпу, ожидаемая зарплата', () => {
    const txs = [
      tx({ date: '2026-10-01', categoryId: 2, amount: R(30000), rub: R(30000) }), // аренда оплачена
      tx({ date: '2026-10-05', categoryId: 3, amount: R(10000), rub: R(10000) }), // переменные: 10 000 за 10 дней
    ]
    const f = monthForecast({ txs, recurring: [rent, loan] }, settings, '2026-10-10')
    expect(f.fixedLeft).toBe(R(15300))
    expect(f.variablePace).toBe(R(31000)) // 10 000 / 10 × 31
    expect(f.expense).toBe(R(30000 + 15300 + 31000))
    expect(f.income).toBe(R(80000))
    expect(f.balance).toBe(R(80000 - 76300))
  })

  it('в начале месяца прогноз опирается на темп прошлых месяцев', () => {
    const txs = [
      tx({ date: '2026-09-10', categoryId: 3, amount: R(30000), rub: R(30000) }), // сентябрь: 1 000 в день
      tx({ date: '2026-10-01', categoryId: 3, amount: R(100), rub: R(100) }), // 2 октября: почти ничего
    ]
    const f = monthForecast({ txs, recurring: [] }, DEFAULT_SETTINGS, '2026-10-02')
    // темп ≈ (100 + 1000×7) / 9 ≈ 789 в день на оставшиеся 29 дней
    expect(f.variablePace).toBe(Math.round(R(100) + ((R(100) + R(1000) * 7) / 9) * 29))
    expect(f.variablePace).toBeGreaterThan(R(20000))
  })

  it('капитал на конец месяцев', () => {
    const accounts = [{ id: 1, name: 'К', currency: 'RUB' as const, openingBalance: R(1000), archived: false, order: 0 }]
    const txs = [
      tx({ date: '2026-08-13', type: 'income', incomeKind: 'salary', amount: R(500), rub: R(500) }),
      tx({ date: '2026-09-02', categoryId: 3, amount: R(700), rub: R(700) }),
    ]
    expect(capitalByMonth(accounts, txs, ['2026-07', '2026-08', '2026-09'], m => m)).toEqual([R(1000), R(1500), R(800)])
  })
})

import { evalAmount, hasOperator } from './money'

describe('калькулятор суммы', () => {
  it('складывает и вычитает', () => {
    expect(evalAmount('300')).toBe(30000)
    expect(evalAmount('300+85')).toBe(38500)
    expect(evalAmount('300+85−20,5')).toBe(36450)
    expect(evalAmount('300+')).toBe(30000)
    expect(evalAmount('100−200')).toBeNull()
    expect(evalAmount('')).toBeNull()
    expect(evalAmount('1,234')).toBeNull()
    expect(hasOperator('300+85')).toBe(true)
    expect(hasOperator('300')).toBe(false)
  })
})

import { accountKind, accountsForEntry } from './calc'

describe('порядок счетов при вводе', () => {
  const acc = (id: number, name: string, order: number, kind?: 'card' | 'savings'): Account =>
    ({ id, name, currency: 'RUB', openingBalance: 0, archived: false, order, kind })
  const accounts = [acc(1, 'Aristo', 0), acc(2, 'Квартира', 1), acc(3, 'Подушка безопасности', 2), acc(4, 'Сбербанк', 3), acc(5, 'Тинькофф Банк', 4), acc(6, 'Наличка', 5), { ...acc(7, 'Т-Инвестиции', 6), kind: 'broker' as const }]

  it('тип по названию, явный тип важнее', () => {
    expect(accounts.map(accountKind)).toEqual(['savings', 'savings', 'savings', 'card', 'card', 'card', 'broker'])
    expect(accountKind(acc(9, 'Тинькофф Банк', 0, 'savings'))).toBe('savings')
  })

  it('карты первыми: основная, затем по частоте трат; потом копилки', () => {
    const txs = [
      tx({ date: '2026-10-01', accountId: 4 }), tx({ date: '2026-10-02', accountId: 6 }), tx({ date: '2026-10-03', accountId: 6 }),
      tx({ date: '2026-10-03', accountId: 2 }), tx({ date: '2025-01-01', accountId: 1 }),
    ]
    expect(accountsForEntry(accounts, txs, 5, '2026-10-04').map(a => a.name))
      .toEqual(['Тинькофф Банк', 'Наличка', 'Сбербанк', 'Квартира', 'Aristo', 'Подушка безопасности', 'Т-Инвестиции'])
  })
})

import { accountColor, goalMonthPlans, monthsUntil, plannedInMonth as planned2, setupSteps } from './calc'

describe('пополнение копилки пополам из зарплаты и аванса', () => {
  const topup: Recurring = { id: 5, kind: 'topup', name: 'Aristo', amount: R(15000), currency: 'RUB', day: 1, categoryId: 32, fundFrom: 'both', reserveAccountId: 40, active: true }
  const settings = { ...DEFAULT_SETTINGS, expectedSalary: R(60000), expectedAdvance: R(40000) }

  it('пополнение не попадает в календарь платежей и в прогноз расходов', () => {
    expect(planned2([topup], settings, '2026-10').filter(e => e.kind === 'payment')).toEqual([])
    expect(monthForecast({ txs: [], recurring: [topup] }, settings, '2026-10-10').fixedLeft).toBe(0)
  })
})

describe('цели со сроком', () => {
  const car: Goal = { id: 1, name: 'Машина', target: R(120000), accountId: 9, priority: 1, deadline: '2026-12' }
  const pillow: Goal = { id: 2, name: 'Подушка', target: R(300000), accountId: 8, priority: 0 }

  it('месяцев до срока', () => {
    expect(monthsUntil('2026-10', '2026-12')).toBe(3)
    expect(monthsUntil('2026-10', '2026-09')).toBe(1)
  })

  it('в месяц нужно (остаток на начало месяца) / месяцев; уже отложенное вычитается', () => {
    const progress = [{ goal: car, saved: R(30000), remaining: R(90000) }]
    const txs = [tx({ type: 'transfer', date: '2026-10-14', accountId: 1, amount: R(10000), rub: R(10000), toAccountId: 9, toAmount: R(10000), toRub: R(10000) })]
    // на начало октября оставалось 100 000 → по 33 334 в месяц, 10 000 уже отложено
    expect(goalMonthPlans([car], progress, txs, '2026-10').get(1)).toEqual({ monthly: 3333334, done: R(10000), left: 3333334 - R(10000) })
  })

  it('сбережения сначала закрывают месячный план целей со сроком, потом по приоритету', () => {
    const remaining = new Map([[1, R(90000)], [2, R(300000)]])
    const monthLeft = new Map([[1, R(20000)]])
    expect(suggestGoals(R(30000), [car, pillow], remaining, monthLeft).map(s => [s.goal.name, s.rub]))
      .toEqual([['Подушка', R(10000)], ['Машина', R(20000)]])
  })
})

describe('цвета счетов и первая настройка', () => {
  const a = (id: number, name: string, color?: 'pink'): Account => ({ id, name, currency: 'RUB', openingBalance: 0, archived: false, order: id, color })
  it('банкам — по названию, остальным — по порядку, явный цвет важнее', () => {
    const all = [a(1, 'Тинькофф Банк'), a(2, 'Сбербанк'), a(3, 'Квартира'), a(4, 'Подушка'), a(5, 'Дом', 'pink')]
    expect(all.map(x => accountColor(x, all))).toEqual(['yellow', 'green', 'blue', 'sky', 'pink'])
  })
  it('пункты настройки отмечаются по данным', () => {
    const steps = setupSteps({ settings: { ...DEFAULT_SETTINGS, expectedSalary: 1, expectedAdvance: 1, lastExportAt: 5 }, recurring: [], goals: [] }, true)
    expect(steps.filter(s => s.done).map(s => s.id)).toEqual(['pay', 'security', 'backup'])
  })
})

import { plural } from './money'
it('склонение', () => {
  const f: [string, string, string] = ['операция', 'операции', 'операций']
  expect([1, 2, 5, 11, 21, 22, 112].map(n => plural(n, f))).toEqual(['операция', 'операции', 'операций', 'операций', 'операция', 'операции', 'операций'])
})
