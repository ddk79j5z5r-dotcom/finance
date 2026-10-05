import type { FinanceDB } from '../db'

/**
 * Удаляет счёт, перенося всё на другой счёт той же валюты: операции, сделки с облигациями,
 * цели, привязки платежей и категорий, начальный баланс. Переводы между этими двумя счетами
 * становятся бессмысленными («сам себе») и удаляются. Общая сумма денег не меняется.
 * Возвращает функцию отмены, которая восстанавливает всё как было.
 */
export async function moveAndDeleteAccount(db: FinanceDB, fromId: number, toId: number): Promise<() => Promise<void>> {
  return db.transaction('rw', [db.accounts, db.txs, db.trades, db.goals, db.recurring, db.categories, db.settings], async () => {
    const from = await db.accounts.get(fromId)
    const to = await db.accounts.get(toId)
    if (!from || !to || fromId === toId) throw new Error('Счёт не найден')
    if (from.currency !== to.currency) throw new Error('Переносить можно только на счёт в той же валюте')

    const txs = (await db.txs.toArray()).filter(t => t.accountId === fromId || t.toAccountId === fromId)
    const trades = await db.trades.where('accountId').equals(fromId).toArray()
    const goals = await db.goals.where('accountId').equals(fromId).toArray()
    const recurring = (await db.recurring.toArray()).filter(r => r.reserveAccountId === fromId)
    const categories = (await db.categories.toArray()).filter(c => c.accountId === fromId)
    const settings = await db.settings.get('main')

    for (const t of txs) {
      const internal = t.type === 'transfer' && [t.accountId, t.toAccountId].includes(fromId) && [t.accountId, t.toAccountId].includes(toId)
      if (internal) { await db.txs.delete(t.id!); continue }
      await db.txs.put({ ...t, accountId: t.accountId === fromId ? toId : t.accountId, toAccountId: t.toAccountId === fromId ? toId : t.toAccountId })
    }
    for (const t of trades) await db.trades.update(t.id!, { accountId: toId })
    for (const g of goals) await db.goals.update(g.id!, { accountId: toId })
    for (const r of recurring) await db.recurring.update(r.id!, { reserveAccountId: toId })
    for (const c of categories) await db.categories.update(c.id!, { accountId: toId })
    if (settings?.defaultAccountId === fromId) await db.settings.update('main', { defaultAccountId: toId })
    await db.accounts.update(toId, { openingBalance: to.openingBalance + from.openingBalance })
    await db.accounts.delete(fromId)

    return async () => {
      await db.transaction('rw', [db.accounts, db.txs, db.trades, db.goals, db.recurring, db.categories, db.settings], async () => {
        await db.accounts.bulkPut([from, to])
        await db.txs.bulkPut(txs)
        await db.trades.bulkPut(trades)
        await db.goals.bulkPut(goals)
        await db.recurring.bulkPut(recurring)
        await db.categories.bulkPut(categories)
        if (settings) await db.settings.put(settings)
      })
    }
  })
}
