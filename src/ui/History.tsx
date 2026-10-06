import { useState } from 'react'
import { db } from '../db'
import { envelopes, fxLoss, rootOf } from '../domain/calc'
import { formatMoney, monthLabel, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type IncomeKind, type Tx, type TxType } from '../domain/types'
import { AccountDot } from './AccountBadge'
import { LimitSheet } from './Budget'
import { Bar, Money, Segmented, Sheet, useOnce } from './common'
import { rootCategories, txView, type Data } from './data'
import { Entry } from './Entry'
import { Badge, categoryIcon, Icon } from './icons'
import { notify } from './undo'

/** Фильтр списка операций. Категория включает свои подкатегории; счёт — и списания, и зачисления. */
export interface OpsFilter {
  accountId?: number
  categoryId?: number
  from?: string // YYYY-MM
  to?: string
  incomeKind?: IncomeKind
}

type TypeFilter = 'all' | TxType

function dayTitle(date: string) {
  const today = todayISO()
  const y = new Date(); y.setDate(y.getDate() - 1)
  const label = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
  if (date === today) return `Сегодня, ${label}`
  if (date === todayISO(y)) return `Вчера, ${label}`
  return label
}

export function matches(data: Data, t: Tx, f: OpsFilter): boolean {
  if (f.accountId != null && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false
  if (f.categoryId != null && (t.type !== 'expense' || (t.categoryId !== f.categoryId && rootOf(data.categories, t.categoryId)?.id !== f.categoryId))) return false
  if (f.incomeKind && (t.type !== 'income' || t.incomeKind !== f.incomeKind)) return false
  const m = monthOf(t.date)
  if (f.from && m < f.from) return false
  if (f.to && m > f.to) return false
  return true
}

export function History({ data, filter, setFilter }: { data: Data; filter: OpsFilter; setFilter: (f: OpsFilter) => void }) {
  const [edit, setEdit] = useState<Tx | null>(null)
  const [type, setType] = useState<TypeFilter>('all')
  const [search, setSearch] = useState<string | null>(null)
  const [limit, setLimit] = useState(150)
  const [filterOpen, setFilterOpen] = useState(false)
  const [limitOpen, setLimitOpen] = useState(false)

  const q = search?.trim().toLowerCase() ?? ''
  const all = [...data.txs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .filter(t => type === 'all' || t.type === type)
    .filter(t => matches(data, t, filter))
    .filter(t => {
      if (!q) return true
      const v = txView(data, t)
      return `${v.title} ${v.sub} ${t.comment}`.toLowerCase().includes(q) || formatMoney(t.amount).replace(/\s/g, '').includes(q.replace(/\s/g, ''))
    })
  const shown = all.slice(0, limit)
  const byDay = new Map<string, Tx[]>()
  for (const t of shown) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])

  const active = filter.accountId != null || filter.categoryId != null || filter.from || filter.to || filter.incomeKind
  const totals = all.reduce((s, t) => {
    if (t.type === 'income') s.in += t.rub
    else if (t.type === 'expense') s.out += t.rub
    else if (filter.accountId != null) { if (t.toAccountId === filter.accountId) s.in += t.toRub ?? t.rub; else s.out += t.rub }
    return s
  }, { in: 0, out: 0 })

  // Конверт категории, если смотрим одну категорию за один месяц.
  const cat = filter.categoryId != null ? data.categories.find(c => c.id === filter.categoryId) : undefined
  const envMonth = filter.from && filter.from === filter.to ? filter.from : null
  const env = cat && cat.parentId == null && envMonth ? envelopes(data.categories, data.limits, data.txs, envMonth).find(e => e.category.id === cat.id) : undefined

  const remove = useOnce(async (t: Tx) => {
    const alloc = await db.allocations.where('txId').equals(t.id!).toArray()
    await db.transaction('rw', db.txs, db.allocations, async () => {
      await db.txs.delete(t.id!)
      await db.allocations.where('txId').equals(t.id!).delete()
    })
    setEdit(null)
    notify('Операция удалена', async () => {
      await db.transaction('rw', db.txs, db.allocations, async () => {
        await db.txs.put(t)
        if (alloc.length) await db.allocations.bulkPut(alloc)
      })
    })
  })

  const chips: { label: string; clear: () => void }[] = []
  if (filter.accountId != null) chips.push({ label: data.accounts.find(a => a.id === filter.accountId)?.name ?? 'счёт', clear: () => setFilter({ ...filter, accountId: undefined }) })
  if (cat) chips.push({ label: cat.name, clear: () => setFilter({ ...filter, categoryId: undefined }) })
  if (filter.incomeKind) chips.push({ label: INCOME_LABEL[filter.incomeKind], clear: () => setFilter({ ...filter, incomeKind: undefined }) })
  if (filter.from || filter.to) {
    const label = filter.from === filter.to ? monthLabel(filter.from!) : `${filter.from ? monthLabel(filter.from) : '…'} — ${filter.to ? monthLabel(filter.to) : '…'}`
    chips.push({ label, clear: () => setFilter({ ...filter, from: undefined, to: undefined }) })
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Операции</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={search !== null ? 'icon-btn on' : 'icon-btn'} aria-label="Поиск" onClick={() => setSearch(s => (s === null ? '' : null))}><Icon name="search" /></button>
          <button className={active ? 'icon-btn on' : 'icon-btn'} aria-label="Фильтр" onClick={() => setFilterOpen(true)}><Icon name="filter" /></button>
        </div>
      </div>
      {search !== null && (
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Категория, комментарий, сумма" style={{ marginBottom: 12 }} />
      )}
      {chips.length > 0 && (
        <div className="scroll-row" style={{ marginBottom: 10 }}>
          {chips.map(c => (
            <button key={c.label} className="chip on" onClick={c.clear}>{c.label} <Icon name="close" size={14} /></button>
          ))}
          <button className="chip" onClick={() => setFilter({})}>Сбросить</button>
        </div>
      )}
      <Segmented value={type} onChange={setType} options={[
        { value: 'all', label: 'Все' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' }, { value: 'transfer', label: 'Переводы' },
      ]} />

      {env && (
        <div className="card">
          <div className="line" style={{ paddingTop: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Badge icon={categoryIcon(cat)} tone={cat!.bucket} size={34} /><strong>{cat!.name}</strong></span>
            <button className="link" onClick={() => setLimitOpen(true)}>{env.limit ? 'Изменить лимит' : 'Задать лимит'}</button>
          </div>
          {env.limit > 0 ? (
            <>
              <Bar value={env.spent} max={env.limit} color={`var(--${cat!.bucket})`} />
              <div className="muted small">
                потрачено <Money v={env.spent} /> из <Money v={env.limit} /> ·{' '}
                <span className={env.available < 0 ? 'neg' : ''}>{env.available < 0 ? 'перерасход' : 'осталось'} <Money v={Math.abs(env.available)} /></span>
              </div>
            </>
          ) : <div className="muted small">лимит не задан</div>}
        </div>
      )}

      {active && all.length > 0 && (
        <div className="muted small" style={{ margin: '0 4px 4px' }}>
          {all.length} {plural(all.length, ['операция', 'операции', 'операций'])}{totals.out > 0 && <> · расход <Money v={totals.out} /></>}{totals.in > 0 && <> · приход <Money v={totals.in} /></>}
        </div>
      )}

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
                  <div className="body">
                    <div className="title">{v.title}</div>
                    <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{acc && <AccountDot color={data.colorOf(acc)} />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.sub}</span></div>
                  </div>
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
      {filterOpen && <FilterSheet data={data} filter={filter} onApply={f => { setFilter(f); setFilterOpen(false) }} onClose={() => setFilterOpen(false)} />}
      {limitOpen && cat && envMonth && <LimitSheet data={data} category={cat} month={envMonth} onClose={() => setLimitOpen(false)} />}
    </div>
  )
}

function FilterSheet({ data, filter, onApply, onClose }: { data: Data; filter: OpsFilter; onApply: (f: OpsFilter) => void; onClose: () => void }) {
  const [f, setF] = useState<OpsFilter>(filter)
  const thisMonth = monthOf(todayISO())
  const presets: { label: string; from?: string; to?: string }[] = [
    { label: 'Этот месяц', from: thisMonth, to: thisMonth },
    { label: 'Прошлый', from: shiftMonth(thisMonth, -1), to: shiftMonth(thisMonth, -1) },
    { label: '3 месяца', from: shiftMonth(thisMonth, -2), to: thisMonth },
    { label: 'Всё время' },
  ]
  const num = (v: string) => (v ? Number(v) : undefined)
  return (
    <Sheet title="Фильтр" onClose={onClose}>
      <label className="field-label">Период</label>
      <div className="chips">
        {presets.map(p => (
          <button key={p.label} type="button" className={f.from === p.from && f.to === p.to ? 'chip on' : 'chip'} onClick={() => setF({ ...f, from: p.from, to: p.to })}>{p.label}</button>
        ))}
      </div>
      <div className="row2" style={{ marginTop: 10 }}>
        <input type="month" value={f.from ?? ''} onChange={e => setF({ ...f, from: e.target.value || undefined })} aria-label="С месяца" />
        <input type="month" value={f.to ?? ''} onChange={e => setF({ ...f, to: e.target.value || undefined })} aria-label="По месяц" />
      </div>
      <label className="field-label">Счёт</label>
      <select value={f.accountId ?? ''} onChange={e => setF({ ...f, accountId: num(e.target.value) })}>
        <option value="">Все счета</option>
        {data.accounts.filter(a => !a.archived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <label className="field-label">Категория расхода</label>
      <select value={f.categoryId ?? ''} onChange={e => setF({ ...f, categoryId: num(e.target.value), incomeKind: undefined })}>
        <option value="">Все категории</option>
        {rootCategories(data.categories).flatMap(c => [
          <option key={c.id} value={c.id}>{c.name}</option>,
          ...data.categories.filter(s => s.parentId === c.id && !s.archived).map(s => <option key={s.id} value={s.id}>{'   '}{c.name} · {s.name}</option>),
        ])}
      </select>
      <label className="field-label">Вид дохода</label>
      <select value={f.incomeKind ?? ''} onChange={e => setF({ ...f, incomeKind: (e.target.value || undefined) as IncomeKind | undefined, categoryId: undefined })}>
        <option value="">Все</option>
        {(Object.keys(INCOME_LABEL) as IncomeKind[]).map(k => <option key={k} value={k}>{INCOME_LABEL[k]}</option>)}
      </select>
      <button className="save" onClick={() => onApply(f)}>Показать</button>
      <button className="secondary" onClick={() => onApply({})}>Сбросить фильтр</button>
    </Sheet>
  )
}
