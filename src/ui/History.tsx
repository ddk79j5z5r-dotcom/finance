import { useState } from 'react'
import { db } from '../db'
import { fxLoss } from '../domain/calc'
import { dateLabel, formatMoney } from '../domain/money'
import { INCOME_LABEL, type Tx } from '../domain/types'
import { Sheet } from './common'
import type { Data } from './data'
import { Entry } from './Entry'

export function History({ data }: { data: Data }) {
  const [edit, setEdit] = useState<Tx | null>(null)
  const [limit, setLimit] = useState(100)
  const acc = new Map(data.accounts.map(a => [a.id!, a]))
  const cat = new Map(data.categories.map(c => [c.id!, c]))

  const sorted = [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, limit)
  const byDay = new Map<string, Tx[]>()
  for (const t of sorted) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])

  function title(t: Tx) {
    if (t.type === 'income') return INCOME_LABEL[t.incomeKind!]
    if (t.type === 'transfer') return `${acc.get(t.accountId)?.name} → ${acc.get(t.toAccountId!)?.name}`
    const c = cat.get(t.categoryId!)
    const parent = c?.parentId != null ? cat.get(c.parentId) : undefined
    return parent ? `${parent.name} · ${c!.name}` : c?.name ?? '—'
  }

  function amount(t: Tx) {
    const a = acc.get(t.accountId)
    if (t.type === 'transfer') {
      const to = acc.get(t.toAccountId!)
      return a?.currency === to?.currency
        ? formatMoney(t.amount, a?.currency)
        : `${formatMoney(t.amount, a?.currency)} → ${formatMoney(t.toAmount!, to?.currency)}`
    }
    return `${t.type === 'expense' ? '−' : '+'}${formatMoney(t.amount, a?.currency)}`
  }

  async function remove(t: Tx) {
    if (!confirm('Удалить операцию?')) return
    await db.transaction('rw', db.txs, db.allocations, async () => {
      await db.txs.delete(t.id!)
      await db.allocations.where('txId').equals(t.id!).delete()
    })
    setEdit(null)
  }

  return (
    <div className="page">
      <h1>Операции</h1>
      {sorted.length === 0 && <p className="hint">Пока пусто. Первую операцию можно записать на вкладке «Ввод».</p>}
      {[...byDay].map(([day, list]) => (
        <div key={day}>
          <div className="day">{dateLabel(day)}</div>
          <div className="card list">
            {list.map(t => (
              <button className="tx" key={t.id} onClick={() => setEdit(t)}>
                <div>
                  <div>{title(t)}</div>
                  <div className="muted small">
                    {t.type !== 'transfer' && acc.get(t.accountId)?.name}
                    {t.comment && ` · ${t.comment}`}
                    {t.type === 'transfer' && fxLoss(t) !== 0 && `разница курса ${formatMoney(fxLoss(t))}`}
                  </div>
                </div>
                <span className={t.type === 'income' ? 'pos' : t.type === 'expense' ? '' : 'muted'}>{amount(t)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {data.txs.length > limit && <button className="secondary" onClick={() => setLimit(l => l + 200)}>Показать ещё</button>}

      {edit && (
        <Sheet title="Операция" onClose={() => setEdit(null)}>
          <Entry data={data} tx={edit} onSaved={() => setEdit(null)} />
          <button className="danger" onClick={() => remove(edit)}>Удалить</button>
        </Sheet>
      )}
    </div>
  )
}
