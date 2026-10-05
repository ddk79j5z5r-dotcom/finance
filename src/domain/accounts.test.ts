import { describe, expect, it } from 'vitest'
import { FinanceDB, saveSettings } from '../db'
import { moveAndDeleteAccount } from './accounts'
import { balances } from './calc'

let n = 0
async function setup() {
  const db = new FinanceDB(`acc-${n++}`)
  const card = await db.accounts.add({ name: 'Тинькофф', currency: 'RUB', openingBalance: 100000, archived: false, order: 0 })
  const old = await db.accounts.add({ name: 'Сентябрь', currency: 'RUB', openingBalance: 50000, archived: false, order: 1 })
  const pillow = await db.accounts.add({ name: 'Подушка', currency: 'RUB', openingBalance: 0, archived: false, order: 2 })
  const usd = await db.accounts.add({ name: 'USD', currency: 'USD', openingBalance: 0, archived: false, order: 3 })
  await saveSettings({ defaultAccountId: old }, db)
  await db.txs.bulkAdd([
    { date: '2026-09-01', type: 'income', incomeKind: 'salary', accountId: old!, amount: 6000000, rub: 6000000, comment: '', createdAt: 1 },
    { date: '2026-09-02', type: 'transfer', accountId: old!, toAccountId: card!, amount: 1000000, rub: 1000000, toAmount: 1000000, toRub: 1000000, comment: '', createdAt: 2 },
    { date: '2026-09-03', type: 'transfer', accountId: old!, toAccountId: pillow!, amount: 500000, rub: 500000, toAmount: 500000, toRub: 500000, comment: '', createdAt: 3 },
    { date: '2026-09-04', type: 'expense', accountId: old!, amount: 30000, rub: 30000, categoryId: 1, comment: '', createdAt: 4 },
    { date: '2026-09-05', type: 'expense', accountId: card!, amount: 10000, rub: 10000, categoryId: 1, comment: '', createdAt: 5 },
  ])
  await db.goals.add({ name: 'Цель', target: 1, accountId: old!, priority: 0 })
  return { db, card: card!, old: old!, pillow: pillow!, usd: usd! }
}

const dump = async (db: FinanceDB) => ({
  accounts: await db.accounts.toArray(), txs: await db.txs.toArray(), goals: await db.goals.toArray(), settings: await db.settings.toArray(),
})

describe('удаление счёта с переносом', () => {
  it('деньги и операции переходят на другой счёт, переводы между ними исчезают, сумма не меняется', async () => {
    const { db, card, old, pillow } = await setup()
    const total = async () => [...balances(await db.accounts.toArray(), await db.txs.toArray()).values()].reduce((a, b) => a + b, 0)
    const before = await total()
    const cardBefore = balances(await db.accounts.toArray(), await db.txs.toArray())
    await moveAndDeleteAccount(db, old, card)

    expect(await db.accounts.get(old)).toBeUndefined()
    expect(await total()).toBe(before)
    const bal = balances(await db.accounts.toArray(), await db.txs.toArray())
    expect(bal.get(card)).toBe(cardBefore.get(card)! + cardBefore.get(old)!)
    expect(bal.get(pillow)).toBe(500000)
    expect((await db.txs.toArray()).some(t => t.accountId === old || t.toAccountId === old)).toBe(false)
    expect(await db.txs.count()).toBe(4) // перевод «Сентябрь → Тинькофф» удалён
    expect((await db.goals.toArray())[0].accountId).toBe(card)
    expect((await db.settings.get('main'))!.defaultAccountId).toBe(card)
  })

  it('«Отменить» возвращает всё как было', async () => {
    const { db, card, old } = await setup()
    const before = await dump(db)
    const undo = await moveAndDeleteAccount(db, old, card)
    await undo()
    const after = await dump(db)
    const byId = <T extends { id?: number }>(a: T[]) => [...a].sort((x, y) => x.id! - y.id!)
    expect(byId(after.accounts)).toEqual(byId(before.accounts))
    expect(byId(after.txs)).toEqual(byId(before.txs))
    expect(after.goals).toEqual(before.goals)
    expect(after.settings).toEqual(before.settings)
  })

  it('нельзя перенести на счёт в другой валюте', async () => {
    const { db, old, usd } = await setup()
    await expect(moveAndDeleteAccount(db, old, usd)).rejects.toThrow('той же валюте')
    expect(await db.accounts.get(old)).toBeDefined()
  })
})
