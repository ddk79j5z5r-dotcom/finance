import { describe, expect, it } from 'vitest'
import { envelopes } from './calc'
import { availableUntilNextIncome, eventStatus, nextIncome } from './plan'
import type { Account, Category, Recurring, Tx } from './types'
import { DEFAULT_SETTINGS } from './types'

const R = (rub: number) => rub * 100
let id = 1
const tx = (p: Partial<Tx>): Tx => ({ id: id++, date: '2026-10-01', type: 'expense', accountId: 1, amount: 0, rub: 0, comment: '', createdAt: 0, ...p })
const acc = (p: Partial<Account> & { id: number; name: string }): Account => ({ currency: 'RUB', openingBalance: 0, archived: false, order: p.id, ...p })

const accounts = [
  acc({ id: 1, name: 'Тинькофф', kind: 'card' }),
  acc({ id: 2, name: 'Сбер', kind: 'card', inTotal: false }), // не в балансе — не считается
  acc({ id: 3, name: 'Квартира', kind: 'savings' }),
]
const recurring: Recurring[] = [
  { id: 1, name: 'Аренда', amount: R(30000), currency: 'RUB', day: 1, categoryId: 10, fundFrom: 'salary', reserveAccountId: 3, active: true },
  { id: 2, name: 'Интернет', amount: R(650), currency: 'RUB', day: 30, categoryId: 11, fundFrom: 'advance', active: true },
  { id: 3, name: 'Кредит', amount: R(15300), currency: 'RUB', day: 29, categoryId: 12, fundFrom: 'advance', active: true },
  { id: 4, name: 'Подписка', amount: R(99), currency: 'RUB', day: 3, categoryId: 13, fundFrom: 'salary', active: true },
  { id: 5, kind: 'topup', name: 'Aristo', amount: R(15000), currency: 'RUB', day: 1, categoryId: 14, fundFrom: 'both', reserveAccountId: 3, active: true },
]
const settings = { ...DEFAULT_SETTINGS, salaryDay: 13, advanceDay: 28 }
const rub = (r: Recurring) => r.amount

describe('доступно до следующего дохода', () => {
  const bal = new Map([[1, R(20000)], [2, R(5000)], [3, R(40000)]])
  const txs = [
    tx({ type: 'income', incomeKind: 'advance', date: '2026-10-28', amount: R(30000), rub: R(30000) }),
    tx({ date: '2026-10-29', categoryId: 12, comment: 'Кредит', amount: R(15300), rub: R(15300) }), // кредит уже оплачен
    tx({ date: '2026-10-03', categoryId: 13, amount: R(99), rub: R(99) }), // октябрьская подписка оплачена
    tx({ date: '2026-10-01', categoryId: 10, amount: R(30000), rub: R(30000), accountId: 3 }), // октябрьская аренда оплачена
  ]
  it('карты в балансе минус неоплаченные обязательства до зарплаты; резерв на копилке и оплаченное не вычитаются', () => {
    const a = availableUntilNextIncome({ accounts, txs, recurring, settings }, bal, '2026-10-31', (v) => v, rub)!
    expect(a.next).toEqual({ date: '2026-11-13', kind: 'salary' })
    expect(a.days).toBe(13)
    expect(a.cash.map(c => c.account.name)).toEqual(['Тинькофф'])
    expect(a.due.map(x => [x.recurring.name, x.late])).toEqual([['Интернет', true], ['Подписка', false]])
    expect(a.skipped.map(x => [x.recurring.name, x.reason])).toEqual([['Аренда', 'paid'], ['Подписка', 'paid'], ['Кредит', 'paid'], ['Аренда', 'reserve']])
    expect(a.total).toBe(R(20000 - 650 - 99))
    expect(a.perDay).toBe(Math.floor(R(20000 - 650 - 99) / 13))
  })
  it('без карт в балансе — нет расчёта, а не выдуманная сумма', () => {
    expect(availableUntilNextIncome({ accounts: [accounts[2]], txs, recurring, settings }, bal, '2026-10-31', v => v, rub)).toBeNull()
  })
  it('следующее поступление — первое ещё не пришедшее', () => {
    expect(nextIncome(recurring, settings, [], '2026-10-28')).toEqual({ date: '2026-10-28', kind: 'advance' })
    expect(nextIncome(recurring, settings, txs, '2026-10-28')).toEqual({ date: '2026-11-13', kind: 'salary' })
  })
})

describe('статусы плановых событий', () => {
  const pay = (r: Recurring, date: string) => ({ date, kind: 'payment' as const, recurring: r })
  it('оплачен / просрочен / ожидается; выплата — пришла или плановая', () => {
    const txs = [tx({ date: '2026-10-29', categoryId: 12, comment: 'Кредит', amount: R(15300), rub: R(15300) })]
    expect(eventStatus(pay(recurring[2], '2026-10-29'), txs, '2026-10-31', rub)).toBe('done')
    expect(eventStatus(pay(recurring[1], '2026-10-30'), txs, '2026-10-31', rub)).toBe('late')
    expect(eventStatus(pay(recurring[0], '2026-11-01'), txs, '2026-10-31', rub)).toBe('wait')
    expect(eventStatus({ date: '2026-11-13', kind: 'salary', amount: 0 }, txs, '2026-10-31')).toBe('plan')
  })
})

describe('лимиты', () => {
  const cats: Category[] = [
    { id: 1, name: 'Подарки', parentId: null, bucket: 'needs', archived: false },
    { id: 2, name: 'Здоровье', parentId: null, bucket: 'needs', archived: false },
    { id: 3, name: 'Кафе', parentId: null, bucket: 'needs', archived: false },
  ]
  it('«лимит 0 ₽» отличается от «без лимита»; старая запись 0 — это снятый лимит', () => {
    const e = envelopes(cats, [
      { categoryId: 1, month: '2026-10', amount: 0, strict: true },
      { categoryId: 2, month: '2026-09', amount: 0 },
      { categoryId: 3, month: '2026-09', amount: R(5000) },
    ], [], '2026-10')
    expect(e.map(x => [x.category.name, x.hasLimit, x.limit])).toEqual([['Подарки', true, 0], ['Здоровье', false, 0], ['Кафе', true, R(5000)]])
  })
})
