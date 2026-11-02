import { describe, expect, it } from 'vitest'
import { FinanceDB } from '../db'
import { CategoryError, deleteCategories, incomeKindFor, mergeCategory, moveCategory, nameTaken, removeOrArchive } from './categories'
import { balances, envelopePlan, envelopes, monthTotals, movements, spendRub, subEnvelopes } from './calc'
import { ensureCatalog, seedIfEmpty } from './seed'
import type { Account, Category, Tx } from './types'

let n = 0
const fresh = () => new FinanceDB(`cat-${n++}`)
const R = (rub: number) => rub * 100
let id = 1
const tx = (p: Partial<Tx>): Tx => ({ id: id++, date: '2026-10-05', type: 'expense', accountId: 1, amount: 0, rub: 0, comment: '', createdAt: 0, ...p })

describe('свой справочник', () => {
  it('новая база — без готовых категорий, только служебная; повторный запуск ничего не добавляет', async () => {
    const db = fresh()
    await seedIfEmpty(db)
    expect((await db.categories.toArray()).map(c => c.name)).toEqual(['Разница курса при обмене'])
    await db.categories.add({ name: 'Продукты', parentId: null, bucket: 'needs', archived: false })
    await seedIfEmpty(db)
    await ensureCatalog(db)
    expect(await db.categories.count()).toBe(2)
    expect((await db.categories.toArray())[1].kind).toBe('expense')
  })

  it('удалённые категории доходов не возвращаются при запуске', async () => {
    const db = fresh()
    await seedIfEmpty(db)
    expect((await db.categories.toArray()).some(c => c.kind === 'income')).toBe(false)
  })

  it('вид дохода — по названию своей категории или её родителя', () => {
    const cats: Category[] = [
      { id: 1, name: 'Работа', parentId: null, bucket: 'needs', archived: false, kind: 'income' },
      { id: 2, name: 'Зарплата', parentId: 1, bucket: 'needs', archived: false, kind: 'income' },
      { id: 3, name: 'Аванс', parentId: 1, bucket: 'needs', archived: false, kind: 'income' },
      { id: 4, name: 'Премия', parentId: 1, bucket: 'needs', archived: false, kind: 'income' },
      { id: 5, name: 'Купоны ОФЗ', parentId: null, bucket: 'needs', archived: false, kind: 'income' },
      { id: 6, name: 'Фриланс', parentId: 1, bucket: 'needs', archived: false, kind: 'income' },
    ]
    expect([2, 3, 4, 5, 6].map(id => incomeKindFor(cats, id))).toEqual(['salary', 'advance', 'bonus', 'interest', 'other'])
  })
})

describe('правка справочника', () => {
  const setup = async () => {
    const db = fresh()
    const car = (await db.categories.add({ name: 'Машина', parentId: null, bucket: 'needs', archived: false, kind: 'expense' }))!
    const auto = (await db.categories.add({ name: 'Автомобиль', parentId: null, bucket: 'needs', archived: false, kind: 'expense' }))!
    const fuel1 = (await db.categories.add({ name: 'Бензин', parentId: car, bucket: 'needs', archived: false, kind: 'expense' }))!
    const fuel2 = (await db.categories.add({ name: 'бензин', parentId: auto, bucket: 'needs', archived: false, kind: 'expense' }))!
    const wash = (await db.categories.add({ name: 'Мойка', parentId: car, bucket: 'needs', archived: false, kind: 'expense' }))!
    const salary = (await db.categories.add({ name: 'Зарплата', parentId: null, bucket: 'needs', archived: false, kind: 'income' }))!
    await db.txs.bulkAdd([tx({ id: undefined, categoryId: fuel1, amount: R(3000), rub: R(3000) }), tx({ id: undefined, categoryId: car, amount: R(500), rub: R(500) }), tx({ id: undefined, categoryId: wash, amount: R(700), rub: R(700) })])
    await db.limits.bulkAdd([{ categoryId: car, month: '2026-10', amount: R(10000) }])
    return { db, car, auto, fuel1, fuel2, wash, salary }
  }

  it('дубль у одного родителя распознаётся без учёта регистра', async () => {
    const { db, car } = await setup()
    const cats = await db.categories.toArray()
    expect(nameTaken(cats, '  БЕНЗИН ', car, 'expense')).toBeTruthy()
    expect(nameTaken(cats, 'Бензин', null, 'expense')).toBeUndefined()
  })

  it('перенос подкатегории: в другой тип и в занятое название — нельзя', async () => {
    const { db, fuel1, auto, wash, salary } = await setup()
    await expect(moveCategory(db, fuel1, auto)).rejects.toThrow(CategoryError)
    await expect(moveCategory(db, wash, salary)).rejects.toThrow(/доходами и расходами/)
    await moveCategory(db, wash, auto)
    expect((await db.categories.get(wash))?.parentId).toBe(auto)
  })

  it('объединение: операции и подкатегории переходят, одноимённые сливаются, лимит переносится, переименование не рвёт связи', async () => {
    const { db, car, auto, fuel2 } = await setup()
    await db.categories.update(auto, { name: 'Авто' }) // переименование: связи по id
    const r = await mergeCategory(db, car, auto)
    expect(r.txs).toBe(3)
    const cats = await db.categories.toArray(), txs = await db.txs.toArray()
    expect(cats.some(c => c.id === car)).toBe(false)
    expect(txs.map(t => t.categoryId).sort()).toEqual([auto, fuel2, cats.find(c => c.name === 'Мойка')!.id].sort())
    expect(cats.filter(c => c.parentId === auto).map(c => c.name).sort()).toEqual(['Мойка', 'бензин'])
    expect((await db.limits.toArray()).map(l => l.categoryId)).toEqual([auto])
  })

  it('используемая категория архивируется, неиспользуемая удаляется', async () => {
    const { db, car, auto } = await setup()
    expect(await removeOrArchive(db, car)).toBe('archived')
    expect((await db.categories.where('parentId').equals(car).toArray()).every(c => c.archived)).toBe(true)
    expect(await removeOrArchive(db, auto)).toBe('deleted') // ни операций, ни лимитов — удаляется вместе с пустой подкатегорией
    expect(await db.categories.where('parentId').equals(auto).count()).toBe(0)
  })

  it('удаление архива: категории с подкатегориями удаляются, операции остаются «без категории», лимиты снимаются', async () => {
    const { db, car } = await setup()
    await removeOrArchive(db, car)
    const n = await deleteCategories(db, [car])
    expect(n).toBe(3)
    expect(await db.categories.where('parentId').equals(car).count()).toBe(0)
    expect((await db.txs.toArray()).every(t => t.categoryId == null)).toBe(true)
    expect(await db.limits.count()).toBe(0)
  })
})

describe('учёт операций', () => {
  const acc = (id: number, kind: Account['kind'], openingBalance = 0): Account => ({ id, name: `#${id}`, currency: 'RUB', openingBalance, archived: false, order: id, kind })
  const accounts = [acc(1, 'card', R(50000)), acc(2, 'credit', R(-20000)), acc(3, 'savings'), acc(4, 'debt'), acc(5, 'broker')]
  const cats: Category[] = [
    { id: 10, name: 'Продукты', parentId: null, bucket: 'needs', archived: false, kind: 'expense' },
    { id: 11, name: 'Мясо', parentId: 10, bucket: 'needs', archived: false, kind: 'expense' },
    { id: 12, name: 'Овощи', parentId: 10, bucket: 'needs', archived: false, kind: 'expense' },
    { id: 20, name: 'Банковские расходы', parentId: null, bucket: 'needs', archived: false, kind: 'expense' },
    { id: 30, name: 'Работа', parentId: null, bucket: 'needs', archived: false, kind: 'income' },
  ]
  const tr = (from: number, to: number, rub: number, p: Partial<Tx> = {}) => tx({ type: 'transfer', accountId: from, toAccountId: to, amount: R(rub), rub: R(rub), toAmount: R(rub), toRub: R(rub), ...p })
  const txs: Tx[] = [
    tx({ type: 'income', categoryId: 30, amount: R(65000), rub: R(65000) }),
    tr(1, 3, 10000), tr(1, 5, 5000), // в копилку и на брокерский — не расход
    tx({ accountId: 2, categoryId: 11, amount: R(3000), rub: R(3000) }), // покупка по кредитке — расход один раз
    tr(1, 2, 3000), // погашение кредитки — не расход
    tr(1, 2, 8000, { group: 'loan-1' }), tx({ categoryId: 20, amount: R(1200), rub: R(1200), group: 'loan-1' }), // кредит: основной долг + проценты
    tr(1, 4, 2000), tr(4, 1, 500), // выдал в долг, вернули часть
    tx({ categoryId: 10, amount: R(4000), rub: R(4000), id: 900 }), tx({ type: 'refund', categoryId: 10, refundOf: 900, amount: R(1500), rub: R(1500) }), // частичный возврат
    tx({ categoryId: 11, amount: R(600), rub: R(600), group: 'split' }), tx({ categoryId: 12, amount: R(400), rub: R(400), group: 'split' }), // разделённая покупка 1 000
    tx({ type: 'adjust', amount: R(-100), rub: R(-100) }), // корректировка остатка — не расход
    tr(2, 1, 20000, { date: '2026-10-20' }), // получение кредита — не доход
  ]

  it('доходы и расходы — только потребительские; переводы, кредиты, долги и корректировки не в счёт', () => {
    expect(monthTotals(txs, '2026-10')).toEqual({ income: R(65000), expense: R(3000 + 1200 + 4000 - 1500 + 1000) })
  })

  it('движение денег показано отдельно', () => {
    expect(movements(accounts, txs, '2026-10', '2026-10')).toEqual({ saved: R(10000), invested: R(5000), repaid: R(11000), borrowed: R(20000), lent: R(2000), returned: R(500) })
  })

  it('остатки: кредитка показывает задолженность, корректировка меняет остаток', () => {
    const b = balances(accounts, txs)
    expect(b.get(2)).toBe(R(-20000 - 3000 + 3000 + 8000 - 20000))
    expect(b.get(1)).toBe(R(50000 + 65000 - 10000 - 5000 - 3000 - 8000 - 1200 - 2000 + 500 - 4000 + 1500 - 1000 - 100 + 20000))
  })

  it('родитель включает подкатегории без двойного счёта; лимиты детей — детализация родителя', () => {
    const limits = [{ categoryId: 11, month: '2026-10', amount: R(2000) }, { categoryId: 12, month: '2026-10', amount: R(1000) }]
    const root = envelopes(cats, limits, txs, '2026-10').find(e => e.category.id === 10)!
    expect(root.spent).toBe(R(3000 + 4000 - 1500 + 600 + 400))
    const subs = subEnvelopes(cats, limits, txs, '2026-10', 10)
    expect(subs.map(s => [s.category.name, s.spent, s.limit])).toEqual([['Мясо', R(3600), R(2000)], ['Овощи', R(400), R(1000)]])
    expect(envelopePlan(root, subs)).toEqual({ limit: R(3000), hasLimit: true, fromSubs: true })
    const withParent = envelopes(cats, [...limits, { categoryId: 10, month: '2026-10', amount: R(9000) }], txs, '2026-10').find(e => e.category.id === 10)!
    expect(envelopePlan(withParent, subs).limit).toBe(R(9000)) // лимит родителя главный, дети не добавляются
  })

  it('возврат уменьшает расход в месяце возврата', () => {
    expect(spendRub(tx({ type: 'refund', rub: R(1500) }))).toBe(R(-1500))
  })
})
