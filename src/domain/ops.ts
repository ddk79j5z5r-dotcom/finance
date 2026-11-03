import { accountKind, rootOf } from './calc'
import { monthOf } from './money'
import type { Account, Category, IncomeKind, Tx } from './types'

/** Фильтр списка операций. Категория включает свои подкатегории; счёт — и списания, и зачисления. */
export interface OpsFilter {
  accountId?: number
  categoryId?: number
  from?: string // YYYY-MM
  to?: string
  incomeKind?: IncomeKind
  /** Только операции без категории (расходы, где категорию не выбрали). */
  noCategory?: boolean
  tag?: string
}

export function matches(data: { categories: Category[] }, t: Tx, f: OpsFilter): boolean {
  if (f.accountId != null && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false
  // Категория — вместе с подкатегориями; возвраты относятся к категории покупки.
  if (f.categoryId != null && (t.type === 'transfer' || t.type === 'adjust' || (t.categoryId !== f.categoryId && rootOf(data.categories, t.categoryId)?.id !== f.categoryId))) return false
  if (f.noCategory && !((t.type === 'expense' || t.type === 'refund') && t.categoryId == null)) return false
  if (f.tag && !t.tags?.includes(f.tag)) return false
  if (f.incomeKind && (t.type !== 'income' || t.incomeKind !== f.incomeKind)) return false
  const m = monthOf(t.date)
  if (f.from && m < f.from) return false
  if (f.to && m > f.to) return false
  return true
}

/** Полное название: «Родитель · Подкатегория». */
export function categoryPath(categories: Category[], id: number | null | undefined) {
  const c = categories.find(x => x.id === id)
  if (!c) return ''
  const p = c.parentId != null ? categories.find(x => x.id === c.parentId) : undefined
  return p ? `${p.name} · ${c.name}` : c.name
}

/** Название перевода по типам счетов: так видно, что это погашение кредита или выдача долга, а не расход. */
export function transferMeaning(data: { accounts: Account[] }, fromId?: number | null, toId?: number | null): string {
  const a = data.accounts.find(x => x.id === fromId), b = data.accounts.find(x => x.id === toId)
  if (!a || !b) return 'Перевод между своими счетами'
  const ka = accountKind(a), kb = accountKind(b)
  if (kb === 'credit') return 'Погашение долга — не расход'
  if (ka === 'credit') return 'Получение кредита или займа — не доход'
  if (kb === 'debt') return 'Выдача в долг — не расход'
  if (ka === 'debt') return 'Возврат долга мне — не доход'
  if (kb === 'broker') return 'Пополнение брокерского счёта — не расход'
  if (kb === 'savings') return 'Откладываю в копилку — не расход'
  return 'Перевод между своими счетами — не доход и не расход'
}
