import { useState } from 'react'
import { db } from '../db'
import { fxLoss } from '../domain/calc'
import { formatMoney, todayISO } from '../domain/money'
import type { Tx, TxType } from '../domain/types'
import { Money, Segmented, Sheet, useOnce } from './common'
import { txView, type Data } from './data'
import { Entry } from './Entry'
import { Badge, Icon } from './icons'

type Filter = 'all' | TxType

function dayTitle(date: string) {
  const today = todayISO()
  const y = new Date(); y.setDate(y.getDate() - 1)
  const label = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
  if (date === today) return `Сегодня, ${label}`
  if (date === todayISO(y)) return `Вчера, ${label}`
  return label
}

export function History({ data }: { data: Data }) {
  const [edit, setEdit] = useState<Tx | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState<string | null>(null)
  const [limit, setLimit] = useState(150)

  const q = search?.trim().toLowerCase() ?? ''
  const all = [...data.txs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .filter(t => filter === 'all' || t.type === filter)
    .filter(t => {
      if (!q) return true
      const v = txView(data, t)
      return `${v.title} ${v.sub} ${t.comment}`.toLowerCase().includes(q) || formatMoney(t.amount).replace(/\s/g, '').includes(q.replace(/\s/g, ''))
    })
  const shown = all.slice(0, limit)
  const byDay = new Map<string, Tx[]>()
  for (const t of shown) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])

  const remove = useOnce(async (t: Tx) => {
    if (!confirm('Удалить операцию?')) return
    await db.transaction('rw', db.txs, db.allocations, async () => {
      await db.txs.delete(t.id!)
      await db.allocations.where('txId').equals(t.id!).delete()
    })
    setEdit(null)
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Операции</h1>
        <button className={search !== null ? 'icon-btn on' : 'icon-btn'} aria-label="Поиск" onClick={() => setSearch(s => (s === null ? '' : null))}>
          <Icon name="search" />
        </button>
      </div>
      {search !== null && (
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Категория, комментарий, сумма" style={{ marginBottom: 12 }} />
      )}
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'Все' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' }, { value: 'transfer', label: 'Переводы' },
      ]} />

      {shown.length === 0 && <p className="hint">{data.txs.length ? 'Ничего не найдено.' : 'Пока пусто — нажми «+» внизу, чтобы записать первую операцию.'}</p>}
      {[...byDay].map(([day, list]) => (
        <div key={day}>
          <div className="day line" style={{ padding: 0 }}>
            <span>{dayTitle(day)}</span>
            {(() => { const spent = list.filter(t => t.type === 'expense').reduce((a, t) => a + t.rub, 0); return spent > 0 ? <span className="muted num">−<Money v={spent} /></span> : null })()}
          </div>
          <div className="card tight">
            {list.map(t => {
              const v = txView(data, t)
              const acc = data.accounts.find(a => a.id === t.accountId)
              const to = data.accounts.find(a => a.id === t.toAccountId)
              const loss = fxLoss(t)
              return (
                <button className="row" key={t.id} onClick={() => setEdit(t)}>
                  <Badge icon={v.icon} tone={v.tone} />
                  <div className="body"><div className="title">{v.title}</div><div className="sub">{v.sub}</div></div>
                  <div className={`amt ${t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : ''}`}>
                    {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}<Money v={t.amount} cur={acc?.currency} />
                    {t.type === 'transfer' && to && to.currency !== acc?.currency && <div className="sub">→ <Money v={t.toAmount!} cur={to.currency} /></div>}
                    {loss !== 0 && <div className="sub">курс {loss > 0 ? '−' : '+'}{formatMoney(Math.abs(loss))}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {all.length > limit && <button className="secondary" onClick={() => setLimit(l => l + 300)}>Показать ещё</button>}

      {edit && (
        <Sheet title="Операция" onClose={() => setEdit(null)}>
          <Entry data={data} tx={edit} onSaved={() => setEdit(null)} />
          <button className="danger" onClick={() => remove(edit)}>Удалить</button>
        </Sheet>
      )}
    </div>
  )
}
