import { useMemo } from 'react'
import { db } from '../db'
import { suggestDistribution } from '../domain/calc'
import { formatMoney, monthOf } from '../domain/money'
import { INCOME_LABEL, type Tx } from '../domain/types'
import { Money, Sheet, useOnce } from './common'
import type { Data } from './data'

/**
 * Рекомендация, что сделать с поступлением: отложить на платежи и цели, остальное свободно.
 * Ничего не записывает в учёт: «Понятно» только отмечает, что подсказка просмотрена (чтобы плашка исчезла).
 */
export function Distribute({ data, tx, onClose }: { data: Data; tx: Tx; onClose: () => void }) {
  const d = useMemo(() => suggestDistribution(
    tx,
    { recurring: data.recurring, goals: data.goals, goalRemainingRub: data.goalRemainingRub, goalMonthLeftRub: data.goalMonthLeftRub },
    r => data.toRub(r.amount, r.currency) ?? 0,
  ), [tx, data])
  const acc = data.accounts.find(a => a.id === tx.accountId)
  const accName = (id?: number | null) => (id != null ? data.accounts.find(a => a.id === id)?.name : undefined)

  const seen = useOnce(async () => {
    await db.allocations.where('txId').equals(tx.id!).delete()
    await db.allocations.add({ txId: tx.id!, month: monthOf(tx.date), needs: 0, wants: 0, savings: 0 })
    onClose()
  })

  return (
    <Sheet title={`${INCOME_LABEL[tx.incomeKind!]}: ${formatMoney(tx.amount, acc?.currency)}`} onClose={onClose}>
      {d.reserves.length > 0 && (
        <>
          <div className="day">Отложить на платежи</div>
          <div className="card tight">
            {d.reserves.map(r => (
              <div className="row" key={r.recurring.id}>
                <div className="body">
                  <div className="title">{r.recurring.name}</div>
                  {accName(r.recurring.reserveAccountId) && <div className="sub">на «{accName(r.recurring.reserveAccountId)}»</div>}
                </div>
                <div className="amt"><Money v={r.rub} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      {d.goals.length > 0 && (
        <>
          <div className="day">Отложить на цели</div>
          <div className="card tight">
            {d.goals.map(g => (
              <div className="row" key={g.goal.id}>
                <div className="body">
                  <div className="title">{g.goal.name}</div>
                  {g.goal.deadline && <div className="sub">чтобы успеть к сроку</div>}
                </div>
                <div className="amt"><Money v={g.rub} /></div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="card">
        <div className="line" style={{ padding: 0 }}>
          <span>Свободно</span>
          <strong className="num" style={{ fontSize: 20 }}><Money v={d.free} /></strong>
        </div>
      </div>
      <p className="hint">Это подсказка — в учёт ничего не записывается. Переводы между счетами делай как обычно.</p>
      <button className="save" onClick={seen}>Понятно</button>
    </Sheet>
  )
}
