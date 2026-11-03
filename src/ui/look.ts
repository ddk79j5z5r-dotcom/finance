import { transferMeaning } from '../domain/ops'
import { INCOME_LABEL, type Tx } from '../domain/types'
import type { Data } from './data'
import { categoryLook, INCOME_ICON } from './icons'

/** Как показать операцию: название слева (категория / вид дохода / смысл перевода), подробности второй строкой. */
export function txLook(data: Data, t: Tx) {
  const acc = data.accounts.find(a => a.id === t.accountId)
  const to = data.accounts.find(a => a.id === t.toAccountId)
  const c = data.categories.find(x => x.id === t.categoryId)
  const tags = (t.tags ?? []).map(x => `#${x}`)
  const parent = c?.parentId != null ? data.categories.find(x => x.id === c.parentId) : undefined
  // Название — то, что человек помнит (комментарий или подкатегория); ниже — категория и счёт.
  const named = (fallback: string, prefix = '') => t.comment
    ? { title: prefix + t.comment, sub: [(parent ?? c)?.name ?? fallback, acc?.name, ...tags].filter(Boolean).join(' · ') }
    : { title: prefix + (c?.name ?? fallback), sub: [parent?.name, acc?.name, ...tags].filter(Boolean).join(' · ') }
  if (t.type === 'income') {
    const coupon = t.incomeKind === 'interest' && t.secid
    if (c && !coupon) { const l = categoryLook(data.categories, c); return { icon: l.icon, color: l.color, tone: 'income' as const, ...named(''), acc, to } }
    return { icon: INCOME_ICON[t.incomeKind ?? 'other'], color: undefined, tone: coupon ? 'coupon' as const : 'income' as const, title: t.comment || INCOME_LABEL[t.incomeKind ?? 'other'], sub: [t.comment ? INCOME_LABEL[t.incomeKind ?? 'other'] : '', acc?.name, ...tags].filter(Boolean).join(' · '), acc, to }
  }
  if (t.type === 'transfer') {
    const meaning = transferMeaning(data, t.accountId, t.toAccountId).split(' — ')[0]
    return { icon: 'transfer' as const, color: undefined, tone: 'transfer' as const, title: t.comment || `${acc?.name ?? '?'} → ${to?.name ?? '?'}`, sub: [t.comment ? `${acc?.name ?? '?'} → ${to?.name ?? '?'}` : meaning, ...tags].filter(Boolean).join(' · '), acc, to }
  }
  if (t.type === 'adjust') return { icon: 'sliders' as const, color: undefined, tone: 'transfer' as const, title: 'Корректировка остатка', sub: [acc?.name, t.comment, ...tags].filter(Boolean).join(' · '), acc, to }
  const l = categoryLook(data.categories, c)
  if (t.type === 'refund') return { icon: l.icon, color: l.color, tone: undefined, ...named('Без категории', 'Возврат: '), acc, to }
  const v = named('Без категории')
  return { icon: l.icon, color: c ? l.color : undefined, tone: undefined, title: v.title, sub: t.group ? `Часть покупки · ${v.sub}` : v.sub, acc, to }
}
