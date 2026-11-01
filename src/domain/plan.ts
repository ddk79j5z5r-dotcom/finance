import { accountKind, isPaid, upcoming, type PlannedEvent } from './calc'
import { monthOf } from './money'
import type { Account, Recurring, Settings, Tx } from './types'

// ---------- «Доступно до следующего дохода» и статусы плановых событий ----------

const dayDiff = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 864e5)

/** Учитывается ли счёт в общем балансе (по умолчанию — да). */
export const inTotal = (a: Account) => !a.archived && a.inTotal !== false

/** Пришла ли плановая выплата: доход этого вида уже записан в месяце события. */
export function incomeReceived(kind: 'salary' | 'advance', date: string, txs: Tx[]): boolean {
  const month = monthOf(date)
  return txs.some(t => t.type === 'income' && t.incomeKind === kind && monthOf(t.date) === month)
}

/** Следующее подтверждённое плановое поступление (зарплата или аванс), которое ещё не пришло. */
export function nextIncome(recurring: Recurring[], settings: Settings, txs: Tx[], today: string): { date: string; kind: 'salary' | 'advance' } | null {
  const ev = upcoming(recurring, settings, today, 62)
    .find(e => (e.kind === 'salary' || e.kind === 'advance') && !incomeReceived(e.kind, e.date, txs))
  return ev && (ev.kind === 'salary' || ev.kind === 'advance') ? { date: ev.date, kind: ev.kind } : null
}

export type EventStatus = 'done' | 'late' | 'wait' | 'plan'

/** Статус планового события: платёж — оплачен / просрочен / ожидается; выплата — пришла / плановая. */
export function eventStatus(e: PlannedEvent, txs: Tx[], today: string, rubOf: (r: Recurring) => number = r => r.amount): EventStatus {
  if (e.kind === 'payment') {
    if (isPaid(e.recurring, txs, monthOf(e.date), rubOf)) return 'done'
    return e.date < today ? 'late' : 'wait'
  }
  return incomeReceived(e.kind, e.date, txs) ? 'done' : 'plan'
}

export interface Available {
  /** До какого поступления считаем. */
  next: { date: string; kind: 'salary' | 'advance' }
  days: number
  /** Собственные деньги на картах, учитываемых в балансе (в ₽ по курсу ЦБ). */
  cash: { account: Account; rub: number }[]
  /** Ещё не оплаченные обязательства до поступления — вычитаются. */
  due: { recurring: Recurring; date: string; rub: number; late: boolean }[]
  /** Обязательства, которые не вычитаются: уже оплачены или оплачиваются из отложенного на копилке. */
  skipped: { recurring: Recurring; date: string; reason: 'paid' | 'reserve' }[]
  total: number
  perDay: number
}

/**
 * Сколько можно тратить до следующего планового поступления:
 * деньги на картах (только учитываемые в балансе) минус не оплаченные обязательства до этой даты,
 * включая просроченные в этом месяце. Платёж, отложенный на копилке, уже вне карт — не вычитается повторно.
 * Нет карт или неизвестна дата поступления — null (вместо выдуманной суммы).
 */
export function availableUntilNextIncome(
  d: { accounts: Account[]; txs: Tx[]; recurring: Recurring[]; settings: Settings },
  bal: Map<number, number>,
  today: string,
  toRub: (minor: number, a: Account) => number | null,
  recurringRub: (r: Recurring) => number,
): Available | null {
  const cards = d.accounts.filter(a => inTotal(a) && accountKind(a) === 'card')
  const next = nextIncome(d.recurring, d.settings, d.txs, today)
  if (!cards.length || !next) return null
  const cash = cards.map(account => ({ account, rub: toRub(bal.get(account.id!) ?? 0, account) ?? 0 }))
  const reserveOutsideCards = (r: Recurring) => {
    const acc = d.accounts.find(a => a.id === r.reserveAccountId)
    return !!acc && accountKind(acc) !== 'card'
  }
  const due: Available['due'] = []
  const skipped: Available['skipped'] = []
  const thisMonth = monthOf(today)
  const events = [
    ...upcoming(d.recurring, d.settings, `${thisMonth}-01`, 62),
  ].filter((e): e is Extract<PlannedEvent, { kind: 'payment' }> => e.kind === 'payment' && e.date < next.date && (e.date >= today || monthOf(e.date) === thisMonth))
  for (const e of events) {
    const r = e.recurring
    if (isPaid(r, d.txs, monthOf(e.date), recurringRub)) skipped.push({ recurring: r, date: e.date, reason: 'paid' })
    else if (reserveOutsideCards(r)) skipped.push({ recurring: r, date: e.date, reason: 'reserve' })
    else due.push({ recurring: r, date: e.date, rub: recurringRub(r), late: e.date < today })
  }
  const total = cash.reduce((s, c) => s + c.rub, 0) - due.reduce((s, x) => s + x.rub, 0)
  const days = Math.max(1, dayDiff(today, next.date))
  return { next, days, cash, due, skipped, total, perDay: Math.floor(Math.max(0, total) / days) }
}

/** Фактическая операция, которой оплачен регулярный платёж в месяце (та же логика, что у isPaid). */
export function paymentTx(r: Recurring, txs: Tx[], month: string, rubOf: (r: Recurring) => number = x => x.amount): Tx | undefined {
  const target = rubOf(r)
  return txs.find(t => t.type === 'expense' && monthOf(t.date) === month && t.categoryId === r.categoryId &&
    (t.comment === r.name || Math.abs(t.rub - target) <= target * 0.1))
}

/** Фактическое поступление для плановой выплаты в месяце события. */
export function incomeTx(kind: 'salary' | 'advance', date: string, txs: Tx[]): Tx | undefined {
  const month = monthOf(date)
  return txs.find(t => t.type === 'income' && t.incomeKind === kind && monthOf(t.date) === month)
}
