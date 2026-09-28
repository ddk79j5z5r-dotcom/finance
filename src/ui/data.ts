import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings } from '../db'
import { balances, goalProgress } from '../domain/calc'
import { convertToRub } from '../domain/rates'
import type { Account, Category, Currency, Rate } from '../domain/types'

/** Все данные приложения одним запросом; объёмы для личного учёта небольшие. */
export function useData() {
  return useLiveQuery(async () => {
    const [accounts, categories, txs, limits, recurring, goals, allocations, settings, rate] = await Promise.all([
      db.accounts.orderBy('order').toArray(),
      db.categories.toArray(),
      db.txs.orderBy('date').toArray(),
      db.limits.toArray(),
      db.recurring.toArray(),
      db.goals.toArray(),
      db.allocations.toArray(),
      getSettings(),
      db.rates.orderBy('date').last(),
    ])
    const bal = balances(accounts, txs)
    const progress = goalProgress(goals, bal)
    const accCurrency = new Map(accounts.map(a => [a.id!, a.currency]))
    const latestRate = rate ?? null
    const toRub = (amount: number, currency: Currency) => convertToRub(amount, currency, latestRate)
    const goalRemainingRub = new Map(progress.map(p => [p.goal.id!, toRub(p.remaining, accCurrency.get(p.goal.accountId) ?? 'RUB') ?? 0]))
    return { accounts, categories, txs, limits, recurring, goals, allocations, settings, latestRate, bal, progress, toRub, goalRemainingRub }
  })
}

export type Data = NonNullable<ReturnType<typeof useData>>

export const activeAccounts = (accounts: Account[]) => accounts.filter(a => !a.archived)
export const rootCategories = (cats: Category[]) => cats.filter(c => c.parentId == null && !c.archived && !c.system)
export const childrenOf = (cats: Category[], id: number) => cats.filter(c => c.parentId === id && !c.archived)
export const rateHint = (rate: Rate | null) => (rate ? `курс ЦБ на ${new Date(rate.date).toLocaleDateString('ru-RU')}` : 'курса пока нет')
