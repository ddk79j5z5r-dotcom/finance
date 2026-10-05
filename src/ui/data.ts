import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings } from '../db'
import { convertToRub } from '../domain/rates'
import { accountColor, balances, goalMonthPlans, goalProgress, rootOf } from '../domain/calc'
import { monthOf, todayISO } from '../domain/money'
import { bondValueByAccount, pendingBondEvents, positions } from '../domain/bonds'
import type { Account, Bucket, Category, Currency, Rate, Tx } from '../domain/types'
import { INCOME_LABEL } from '../domain/types'
import { categoryIcon, INCOME_ICON, type IconName } from './icons'

/** Все данные приложения одним запросом; объёмы для личного учёта небольшие. */
export function useData() {
  return useLiveQuery(async () => {
    const [accounts, categories, txs, limits, recurring, goals, allocations, settings, rate, lock, trades, bonds, bondMarks] = await Promise.all([
      db.accounts.orderBy('order').toArray(),
      db.categories.toArray(),
      db.txs.orderBy('date').toArray(),
      db.limits.toArray(),
      db.recurring.toArray(),
      db.goals.toArray(),
      db.allocations.toArray(),
      getSettings(),
      db.rates.orderBy('date').last(),
      db.lock.get('lock'),
      db.trades.orderBy('date').toArray(),
      db.bonds.toArray(),
      db.bondMarks.toArray(),
    ])
    const today = todayISO()
    const bal = balances(accounts, txs, trades)
    const bondPositions = positions(trades, bonds, txs, today)
    const bondValue = bondValueByAccount(bondPositions)
    // Стоимость счёта: свободные деньги + облигации по рынку (с НКД).
    const value = new Map([...bal].map(([id, v]) => [id, v + (bondValue.get(id) ?? 0)]))
    const taxFree = (id: number) => !!accounts.find(a => a.id === id)?.taxFree
    const pendingBond = pendingBondEvents(trades, bonds, txs, bondMarks, today, taxFree)
    const progress = goalProgress(goals, value)
    const accCurrency = new Map(accounts.map(a => [a.id!, a.currency]))
    const latestRate = rate ?? null
    const toRub = (amount: number, currency: Currency) => convertToRub(amount, currency, latestRate)
    const goalRemainingRub = new Map(progress.map(p => [p.goal.id!, toRub(p.remaining, accCurrency.get(p.goal.accountId) ?? 'RUB') ?? 0]))
    const goalPlans = goalMonthPlans(goals, progress, txs, monthOf(todayISO()))
    const goalMonthLeftRub = new Map([...goalPlans].map(([id, p]) => {
      const g = goals.find(x => x.id === id)!
      return [id, toRub(p.left, accCurrency.get(g.accountId) ?? 'RUB') ?? 0]
    }))
    const lockEnabled = lock?.pinHash != null
    const colorOf = (a: Account) => accountColor(a, accounts)
    return {
      accounts, categories, txs, limits, recurring, goals, allocations, settings, latestRate, bal, progress, toRub,
      goalRemainingRub, goalPlans, goalMonthLeftRub, lockEnabled, colorOf,
      trades, bonds, bondPositions, bondValue, value, taxFree, pendingBond,
    }
  })
}

export type Data = NonNullable<ReturnType<typeof useData>>

export const activeAccounts = (accounts: Account[]) => accounts.filter(a => !a.archived)
export const rootCategories = (cats: Category[]) => cats.filter(c => c.parentId == null && !c.archived && !c.system)
export const childrenOf = (cats: Category[], id: number) => cats.filter(c => c.parentId === id && !c.archived)
export const rateHint = (rate: Rate | null) => (rate ? `курс ЦБ на ${new Date(rate.date).toLocaleDateString('ru-RU')}` : 'курса пока нет')

/** Иконка, тон и подписи операции для списков. */
export function txView(data: Data, t: Tx): { icon: IconName; tone: Bucket | 'income' | 'transfer'; title: string; sub: string } {
  const acc = (id?: number) => data.accounts.find(a => a.id === id)?.name ?? ''
  if (t.type === 'income') {
    return { icon: INCOME_ICON[t.incomeKind!], tone: 'income', title: INCOME_LABEL[t.incomeKind!], sub: [acc(t.accountId), t.comment].filter(Boolean).join(' · ') }
  }
  if (t.type === 'transfer') {
    return { icon: 'transfer', tone: 'transfer', title: `${acc(t.accountId)} → ${acc(t.toAccountId)}`, sub: t.comment || 'Перевод' }
  }
  const c = data.categories.find(x => x.id === t.categoryId)
  const root = rootOf(data.categories, t.categoryId)
  return {
    icon: categoryIcon(root),
    tone: root?.bucket ?? 'wants',
    title: t.comment || c?.name || '—',
    sub: [c && root && c.id !== root.id ? `${root.name} · ${c.name}` : root?.name, acc(t.accountId)].filter(Boolean).join(' · '),
  }
}
