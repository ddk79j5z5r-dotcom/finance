import { describe, expect, it } from 'vitest'
import { categoryPath, matches, transferMeaning } from './ops'
import type { Account, Category, Tx } from './types'

const cat = (id: number, name: string, parentId: number | null = null): Category =>
  ({ id, name, parentId, bucket: 'needs', archived: false, kind: 'expense' })
// 1 Еда (2 Кафе, 3 Магазины), 4 Транспорт
const categories = [cat(1, 'Еда'), cat(2, 'Кафе', 1), cat(3, 'Магазины', 1), cat(4, 'Транспорт')]
const data = { categories }

let nextId = 1
const tx = (p: Partial<Tx>): Tx => ({
  id: nextId++, date: '2026-10-10', type: 'expense', accountId: 1, amount: 100, rub: 100, comment: '', createdAt: 0, ...p,
})

describe('matches: без фильтра', () => {
  it('пустой фильтр пропускает любую операцию', () => {
    expect(matches(data, tx({}), {})).toBe(true)
    expect(matches(data, tx({ type: 'transfer', toAccountId: 2 }), {})).toBe(true)
  })
})

describe('matches: счёт', () => {
  it('находит операцию по счёту-источнику', () => {
    expect(matches(data, tx({ accountId: 1 }), { accountId: 1 })).toBe(true)
  })
  it('находит перевод по счёту-получателю', () => {
    expect(matches(data, tx({ type: 'transfer', accountId: 1, toAccountId: 2 }), { accountId: 2 })).toBe(true)
  })
  it('не находит операцию с другим счётом', () => {
    expect(matches(data, tx({ accountId: 1 }), { accountId: 3 })).toBe(false)
    expect(matches(data, tx({ type: 'transfer', accountId: 1, toAccountId: 2 }), { accountId: 3 })).toBe(false)
  })
})

describe('matches: категория', () => {
  it('точное совпадение категории', () => {
    expect(matches(data, tx({ categoryId: 4 }), { categoryId: 4 })).toBe(true)
  })
  it('фильтр по корню включает подкатегории', () => {
    expect(matches(data, tx({ categoryId: 2 }), { categoryId: 1 })).toBe(true)
    expect(matches(data, tx({ categoryId: 3 }), { categoryId: 1 })).toBe(true)
  })
  it('фильтр по подкатегории не включает соседнюю и родителя', () => {
    expect(matches(data, tx({ categoryId: 3 }), { categoryId: 2 })).toBe(false)
    expect(matches(data, tx({ categoryId: 1 }), { categoryId: 2 })).toBe(false)
  })
  it('другая категория не подходит', () => {
    expect(matches(data, tx({ categoryId: 4 }), { categoryId: 1 })).toBe(false)
  })
  it('операция без категории не подходит под фильтр категории', () => {
    expect(matches(data, tx({}), { categoryId: 1 })).toBe(false)
  })
  it('возврат относится к категории покупки', () => {
    expect(matches(data, tx({ type: 'refund', categoryId: 2 }), { categoryId: 1 })).toBe(true)
  })
  it('переводы исключаются фильтром категории, даже если у них проставлена категория', () => {
    expect(matches(data, tx({ type: 'transfer', toAccountId: 2, categoryId: 1 }), { categoryId: 1 })).toBe(false)
  })
  it('корректировки исключаются фильтром категории', () => {
    expect(matches(data, tx({ type: 'adjust', categoryId: 1 }), { categoryId: 1 })).toBe(false)
  })
})

describe('matches: noCategory', () => {
  it('пропускает расход без категории', () => {
    expect(matches(data, tx({ type: 'expense' }), { noCategory: true })).toBe(true)
  })
  it('пропускает возврат без категории', () => {
    expect(matches(data, tx({ type: 'refund' }), { noCategory: true })).toBe(true)
  })
  it('не пропускает расход с категорией', () => {
    expect(matches(data, tx({ categoryId: 4 }), { noCategory: true })).toBe(false)
  })
  it('не пропускает доходы, переводы и корректировки', () => {
    expect(matches(data, tx({ type: 'income' }), { noCategory: true })).toBe(false)
    expect(matches(data, tx({ type: 'transfer', toAccountId: 2 }), { noCategory: true })).toBe(false)
    expect(matches(data, tx({ type: 'adjust' }), { noCategory: true })).toBe(false)
  })
})

describe('matches: метка', () => {
  it('находит операцию с нужной меткой', () => {
    expect(matches(data, tx({ tags: ['отпуск', 'еда'] }), { tag: 'отпуск' })).toBe(true)
  })
  it('не находит без метки или с другой меткой', () => {
    expect(matches(data, tx({ tags: ['еда'] }), { tag: 'отпуск' })).toBe(false)
    expect(matches(data, tx({}), { tag: 'отпуск' })).toBe(false)
  })
})

describe('matches: вид дохода', () => {
  it('находит доход нужного вида', () => {
    expect(matches(data, tx({ type: 'income', incomeKind: 'salary' }), { incomeKind: 'salary' })).toBe(true)
  })
  it('не находит доход другого вида', () => {
    expect(matches(data, tx({ type: 'income', incomeKind: 'advance' }), { incomeKind: 'salary' })).toBe(false)
  })
  it('не находит не-доход, даже если вид указан', () => {
    expect(matches(data, tx({ type: 'expense', incomeKind: 'salary' }), { incomeKind: 'salary' })).toBe(false)
  })
})

describe('matches: период', () => {
  it('границы from и to включительно (по месяцу)', () => {
    const f = { from: '2026-09', to: '2026-11' }
    expect(matches(data, tx({ date: '2026-09-01' }), f)).toBe(true)
    expect(matches(data, tx({ date: '2026-11-30' }), f)).toBe(true)
  })
  it('до начала и после конца периода не подходит', () => {
    const f = { from: '2026-09', to: '2026-11' }
    expect(matches(data, tx({ date: '2026-08-31' }), f)).toBe(false)
    expect(matches(data, tx({ date: '2026-12-01' }), f)).toBe(false)
  })
  it('работает с одной границей', () => {
    expect(matches(data, tx({ date: '2020-01-01' }), { to: '2026-10' })).toBe(true)
    expect(matches(data, tx({ date: '2030-01-01' }), { from: '2026-10' })).toBe(true)
  })
  it('фильтры комбинируются через И', () => {
    const f = { categoryId: 1, from: '2026-10', to: '2026-10', tag: 'x' }
    expect(matches(data, tx({ categoryId: 2, tags: ['x'] }), f)).toBe(true)
    expect(matches(data, tx({ categoryId: 2, tags: ['y'] }), f)).toBe(false)
    expect(matches(data, tx({ categoryId: 2, tags: ['x'], date: '2026-09-30' }), f)).toBe(false)
  })
})

describe('categoryPath', () => {
  it('подкатегория: «Родитель · Дочерняя»', () => {
    expect(categoryPath(categories, 2)).toBe('Еда · Кафе')
  })
  it('корневая категория — просто имя', () => {
    expect(categoryPath(categories, 4)).toBe('Транспорт')
  })
  it('неизвестный id, null и undefined — пустая строка', () => {
    expect(categoryPath(categories, 999)).toBe('')
    expect(categoryPath(categories, null)).toBe('')
    expect(categoryPath(categories, undefined)).toBe('')
  })
  it('если родитель не найден, показывает только имя', () => {
    expect(categoryPath([cat(5, 'Сирота', 77)], 5)).toBe('Сирота')
  })
})

describe('transferMeaning', () => {
  const acc = (id: number, kind?: Account['kind'], name = 'Счёт'): Account =>
    ({ id, name, currency: 'RUB', openingBalance: 0, archived: false, order: id, kind })
  const d = {
    accounts: [
      acc(1, 'card'), acc(2, 'card'), acc(3, 'credit'), acc(4, 'debt'),
      acc(5, 'broker'), acc(6, 'savings'), acc(7, undefined, 'Сбербанк'), acc(8, undefined, 'Подушка'),
    ],
  }
  const m = (from?: number | null, to?: number | null) => transferMeaning(d, from, to)

  it('карта → карта: обычный перевод', () => {
    expect(m(1, 2)).toBe('Перевод между своими счетами — не доход и не расход')
  })
  it('на кредит: погашение долга', () => {
    expect(m(1, 3)).toBe('Погашение долга — не расход')
  })
  it('с кредита: получение кредита', () => {
    expect(m(3, 1)).toBe('Получение кредита или займа — не доход')
  })
  it('на счёт долга: выдача в долг', () => {
    expect(m(1, 4)).toBe('Выдача в долг — не расход')
  })
  it('со счёта долга: возврат долга мне', () => {
    expect(m(4, 1)).toBe('Возврат долга мне — не доход')
  })
  it('на брокерский счёт: пополнение', () => {
    expect(m(1, 5)).toBe('Пополнение брокерского счёта — не расход')
  })
  it('в копилку: откладываю', () => {
    expect(m(1, 6)).toBe('Откладываю в копилку — не расход')
  })
  it('из копилки на карту — обычный перевод', () => {
    expect(m(6, 1)).toBe('Перевод между своими счетами — не доход и не расход')
  })
  it('вид счёта без явного kind угадывается по названию', () => {
    expect(m(7, 8)).toBe('Откладываю в копилку — не расход') // «Сбербанк» → карта, «Подушка» → копилка
  })
  it('кредит → кредит: приоритет у погашения', () => {
    expect(m(3, 3)).toBe('Погашение долга — не расход')
  })
  it('нет счёта-источника, получателя или id — нейтральная формулировка', () => {
    expect(m(999, 1)).toBe('Перевод между своими счетами')
    expect(m(1, 999)).toBe('Перевод между своими счетами')
    expect(m(undefined, null)).toBe('Перевод между своими счетами')
  })
})
