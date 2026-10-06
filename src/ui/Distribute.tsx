import { useMemo } from 'react'
import { db } from '../db'
import { allocationOf, suggestDistribution } from '../domain/calc'
import { formatMoney, monthOf } from '../domain/money'
import { BUCKETS, INCOME_LABEL, REGULAR_INCOME, type Tx } from '../domain/types'
import { Money, Sheet, useOnce } from './common'
import type { Data } from './data'

const dayLabel = (d: number) => `${d}-го`

/**
 * Рекомендация, как разложить поступление по 50/30/20. Ничего не записывает в учёт:
 * «Понятно» только отмечает, что подсказка просмотрена (чтобы плашка на главной исчезла).
 */
export function Distribute({ data, tx, onClose }: { data: Data; tx: Tx; onClose: () => void }) {
  const d = useMemo(() => suggestDistribution(
    tx,
    { txs: data.txs, recurring: data.recurring, goals: data.goals, categories: data.categories, accounts: data.accounts, goalRemainingRub: data.goalRemainingRub, goalMonthLeftRub: data.goalMonthLeftRub },
    data.settings,
    r => data.toRub(r.amount, r.currency) ?? 0,
  ), [tx, data])
  const total = allocationOf(d)
  const kind = tx.incomeKind!
  const acc = data.accounts.find(a => a.id === tx.accountId)
  const reservedBy = (b: string) => d.reserves.filter(r => r.bucket === b)

  const seen = useOnce(async () => {
    await db.allocations.where('txId').equals(tx.id!).delete()
    await db.allocations.add({ txId: tx.id!, month: monthOf(tx.date), ...total })
    onClose()
  })

  return (
    <Sheet title={`${INCOME_LABEL[kind]}: ${formatMoney(tx.amount, acc?.currency)}`} onClose={onClose}>
      <p className="hint">
        {REGULAR_INCOME.includes(kind)
          ? `Рекомендация по правилу ${data.settings.rule.needs}/${data.settings.rule.wants}/${data.settings.rule.savings}: сколько оставить на картах и копилках-нуждах, сколько перевести на счета желаний и сбережений — с учётом обязательных платежей и прошлых выплат месяца.`
          : 'Нерегулярные деньги разумно целиком отложить.'}
      </p>
      <div className="card">
        {BUCKETS.map(b => (
          <div key={b} style={{ padding: '6px 0' }}>
            <div className="line" style={{ padding: 0 }}>
              <span>{b === 'needs' ? 'Оставить на нужды' : b === 'wants' ? 'На счета желаний' : 'Отложить в сбережения'}</span>
              <strong className="num"><Money v={total[b]} /></strong>
            </div>
            {reservedBy(b).length > 0 && (
              <div className="muted small">в т.ч. {reservedBy(b).map(r => `${r.recurring.name}${r.recurring.kind === 'topup' ? '' : ` (${dayLabel(r.recurring.day)})`} ${formatMoney(r.rub)}`).join(', ')}</div>
            )}
          </div>
        ))}
      </div>
      {d.goalSuggestions.length > 0 && (
        <p className="hint">
          Отложить можно на цели: {d.goalSuggestions.map(s => `${s.goal.name} — ${formatMoney(s.rub)}`).join(', ')}.
        </p>
      )}
      <p className="hint">Это подсказка — в учёт ничего не записывается. Переводы между счетами делай как обычно.</p>
      <button className="save" onClick={seen}>Понятно</button>
    </Sheet>
  )
}
