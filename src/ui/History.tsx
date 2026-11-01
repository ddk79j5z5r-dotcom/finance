import { useState } from 'react'
import { envelopes, rootOf } from '../domain/calc'
import { monthLabel, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type IncomeKind, type Tx, type TxType } from '../domain/types'
import { LimitSheet } from './Budget'
import { Empty, Money, Segmented, Sheet } from './common'
import { rootCategories, type Data } from './data'
import { Icon } from './icons'
import { CategoryRow, dayTitle, TxRow, TxSheet, txLook } from './rows'

/** Фильтр списка операций. Категория включает свои подкатегории; счёт — и списания, и зачисления. */
export interface OpsFilter {
  accountId?: number
  categoryId?: number
  from?: string // YYYY-MM
  to?: string
  incomeKind?: IncomeKind
}

type TypeFilter = 'all' | TxType

export function matches(data: Data, t: Tx, f: OpsFilter): boolean {
  if (f.accountId != null && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false
  if (f.categoryId != null && (t.type !== 'expense' || (t.categoryId !== f.categoryId && rootOf(data.categories, t.categoryId)?.id !== f.categoryId))) return false
  if (f.incomeKind && (t.type !== 'income' || t.incomeKind !== f.incomeKind)) return false
  const m = monthOf(t.date)
  if (f.from && m < f.from) return false
  if (f.to && m > f.to) return false
  return true
}

function periodLabel(f: OpsFilter) {
  if (!f.from && !f.to) return 'Всё время'
  if (f.from === f.to) return monthLabel(f.from!)
  return `${f.from ? monthLabel(f.from) : '…'} — ${f.to ? monthLabel(f.to) : '…'}`
}

export function History({ data, filter, setFilter }: { data: Data; filter: OpsFilter; setFilter: (f: OpsFilter) => void }) {
  const [open, setOpen] = useState<Tx | null>(null)
  const [type, setType] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(150)
  const [pick, setPick] = useState<'period' | 'account' | 'category' | 'income' | null>(null)
  const [limitOpen, setLimitOpen] = useState(false)

  const q = search.trim().toLowerCase()
  const qNum = q.replace(/\s/g, '').replace(',', '.')
  const all = [...data.txs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .filter(t => type === 'all' || t.type === type)
    .filter(t => matches(data, t, filter))
    .filter(t => {
      if (!q) return true
      const v = txLook(data, t)
      return `${v.title} ${v.sub}`.toLowerCase().includes(q) || (/^[\d.]+$/.test(qNum) && String(t.amount / 100).includes(qNum))
    })
  const shown = all.slice(0, limit)
  const byDay = new Map<string, Tx[]>()
  for (const t of shown) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])

  // Итоги — по текущей выборке. Переводы между своими счетами не доход и не расход;
  // при фильтре по счёту приход/уход по нему считается движением этого счёта.
  const totals = all.reduce((s, t) => {
    if (t.type === 'income') s.in += t.rub
    else if (t.type === 'expense') s.out += t.rub
    else if (filter.accountId != null) { if (t.toAccountId === filter.accountId) s.in += t.toRub ?? t.rub; else s.out += t.rub }
    return s
  }, { in: 0, out: 0 })

  const single = filter.from && filter.from === filter.to ? filter.from : null
  const cat = filter.categoryId != null ? data.categories.find(c => c.id === filter.categoryId) : undefined
  const env = cat && cat.parentId == null && single ? envelopes(data.categories, data.limits, data.txs, single).find(e => e.category.id === cat.id) : undefined
  const anyFilter = filter.accountId != null || filter.categoryId != null || filter.incomeKind || type !== 'all' || q
  const reset = () => { setFilter({ from: filter.from, to: filter.to }); setType('all'); setSearch('') }
  const acc = filter.accountId != null ? data.accounts.find(a => a.id === filter.accountId) : undefined

  return (
    <div className="page">
      <div className="page-head"><h1>Операции</h1></div>
      <label className="search">
        <Icon name="search" size={16} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: название, комментарий, сумма" aria-label="Поиск операций" autoComplete="off" enterKeyHint="search" />
        {search && <button className="icon-btn" style={{ width: '2rem', height: '2rem' }} aria-label="Очистить поиск" onClick={() => setSearch('')}><Icon name="close" size={14} /></button>}
      </label>

      <div className="month-nav">
        <button className="icon-btn" aria-label="Предыдущий месяц" disabled={!single} style={{ opacity: single ? 1 : 0.3 }} onClick={() => single && setFilter({ ...filter, from: shiftMonth(single, -1), to: shiftMonth(single, -1) })}><Icon name="left" /></button>
        <button onClick={() => setPick('period')} aria-label={`Период: ${periodLabel(filter)}. Изменить`}><strong>{periodLabel(filter)}</strong> <Icon name="right" size={12} /></button>
        <button className="icon-btn" aria-label="Следующий месяц" disabled={!single || single >= monthOf(todayISO())} style={{ opacity: single && single < monthOf(todayISO()) ? 1 : 0.3 }} onClick={() => single && setFilter({ ...filter, from: shiftMonth(single, 1), to: shiftMonth(single, 1) })}><Icon name="right" /></button>
      </div>

      <Segmented value={type} onChange={setType} options={[
        { value: 'all', label: 'Все' }, { value: 'expense', label: 'Расходы' }, { value: 'income', label: 'Доходы' }, { value: 'transfer', label: 'Переводы' },
      ]} />
      <div className="chips" style={{ marginBottom: '0.6rem' }}>
        <button className={acc ? 'chip on' : 'chip'} aria-pressed={!!acc} onClick={() => setPick('account')}><span>{acc?.name ?? 'Все счета'}</span><Icon name="right" size={11} /></button>
        {type !== 'income' && type !== 'transfer' && <button className={cat ? 'chip on' : 'chip'} aria-pressed={!!cat} onClick={() => setPick('category')}><span>{cat?.name ?? 'Все категории'}</span><Icon name="right" size={11} /></button>}
        {(type === 'income' || filter.incomeKind) && <button className={filter.incomeKind ? 'chip on' : 'chip'} aria-pressed={!!filter.incomeKind} onClick={() => setPick('income')}><span>{filter.incomeKind ? INCOME_LABEL[filter.incomeKind] : 'Вид дохода'}</span><Icon name="right" size={11} /></button>}
        {anyFilter && <button className="chip clear" onClick={reset}>Сбросить</button>}
      </div>

      <div className="trio" aria-live="polite">
        <div><span className="k">{plural(all.length, ['Операция', 'Операции', 'Операций'])}</span><span className="v">{all.length}</span></div>
        <div><span className="k">{filter.accountId != null ? 'Ушло' : 'Расход'}</span><span className="v">{totals.out ? '−' : ''}<Money v={totals.out} /></span></div>
        <div><span className="k">{filter.accountId != null ? 'Пришло' : 'Приход'}</span><span className="v pos"><Money v={totals.in} sign /></span></div>
      </div>

      {env && (
        <div className="list">
          <CategoryRow e={env} onOpen={() => setLimitOpen(true)} />
          <button className="row noic" onClick={() => setLimitOpen(true)}><span className="body link">{env.hasLimit ? 'Изменить лимит' : 'Задать лимит'}</span></button>
        </div>
      )}

      {shown.length === 0 && (
        <div className="list">{data.txs.length
          ? <Empty title="Ничего не найдено">Измени период или сбрось фильтры.</Empty>
          : <Empty title="Операций пока нет">Нажми «+» внизу, чтобы записать первую.</Empty>}</div>
      )}
      {[...byDay].map(([day, list]) => {
        const net = list.reduce((s, t) => s + (t.type === 'expense' ? -t.rub : t.type === 'income' ? t.rub : 0), 0)
        return (
          <section key={day} aria-label={dayTitle(day)}>
            <div className="day"><span>{dayTitle(day)}</span>{net !== 0 && <span className={net > 0 ? 'pos' : ''}><Money v={net} sign /></span>}</div>
            <div className="list">{list.map(t => <TxRow key={t.id} data={data} t={t} onOpen={setOpen} />)}</div>
          </section>
        )
      })}
      {all.length > limit && <button className="secondary" onClick={() => setLimit(l => l + 300)}>Показать ещё {Math.min(300, all.length - limit)}</button>}

      {open && <TxSheet data={data} tx={open} onClose={() => setOpen(null)} />}
      {pick === 'period' && <PeriodSheet filter={filter} onPick={f => { setFilter({ ...filter, ...f }); setPick(null) }} onClose={() => setPick(null)} />}
      {pick === 'account' && (
        <PickSheet title="Счёт" value={filter.accountId ?? null} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все счета' }, ...data.accounts.filter(a => !a.archived).map(a => ({ value: a.id!, label: a.name }))]}
          onPick={v => { setFilter({ ...filter, accountId: v ?? undefined }); setPick(null) }} />
      )}
      {pick === 'category' && (
        <PickSheet title="Категория" value={filter.categoryId ?? null} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все категории' }, ...rootCategories(data.categories).flatMap(c => [
            { value: c.id!, label: c.name },
            ...data.categories.filter(s => s.parentId === c.id && !s.archived).map(s => ({ value: s.id!, label: `${c.name} · ${s.name}`, indent: true })),
          ])]}
          onPick={v => { setFilter({ ...filter, categoryId: v ?? undefined, incomeKind: undefined }); setType('all'); setPick(null) }} />
      )}
      {pick === 'income' && (
        <PickSheet title="Вид дохода" value={filter.incomeKind ?? null} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все' }, ...(Object.keys(INCOME_LABEL) as IncomeKind[]).map(k => ({ value: k, label: INCOME_LABEL[k] }))]}
          onPick={v => { setFilter({ ...filter, incomeKind: v ?? undefined, categoryId: undefined }); setPick(null) }} />
      )}
      {limitOpen && cat && single && <LimitSheet data={data} category={cat} month={single} onClose={() => setLimitOpen(false)} />}
    </div>
  )
}

/** Выбор одного значения списком: выбранное отмечено галочкой. */
export function PickSheet<T extends string | number>({ title, options, value, onPick, onClose }: {
  title: string; options: { value: T | null; label: string; indent?: boolean }[]; value: T | null; onPick: (v: T | null) => void; onClose: () => void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        {options.map(o => (
          <button key={String(o.value)} className="row noic" aria-pressed={o.value === value} onClick={() => onPick(o.value)} style={o.indent ? { paddingLeft: '1.6rem' } : undefined}>
            <span className="body">{o.label}</span>{o.value === value && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** Период: быстрые варианты и произвольный диапазон месяцев. */
function PeriodSheet({ filter, onPick, onClose }: { filter: OpsFilter; onPick: (f: OpsFilter) => void; onClose: () => void }) {
  const m = monthOf(todayISO())
  const [from, setFrom] = useState(filter.from ?? '')
  const [to, setTo] = useState(filter.to ?? '')
  const presets: { label: string; from?: string; to?: string }[] = [
    { label: 'Этот месяц', from: m, to: m },
    { label: 'Прошлый месяц', from: shiftMonth(m, -1), to: shiftMonth(m, -1) },
    { label: 'Последние 3 месяца', from: shiftMonth(m, -2), to: m },
    { label: 'Этот год', from: `${m.slice(0, 4)}-01`, to: m },
    { label: 'Всё время' },
  ]
  return (
    <Sheet title="Период" onClose={onClose}>
      <div className="list">
        {presets.map(p => (
          <button key={p.label} className="row noic" onClick={() => onPick({ from: p.from, to: p.to })}>
            <span className="body">{p.label}</span>{filter.from === p.from && filter.to === p.to && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      <label className="field-label">Свой диапазон</label>
      <div className="row2">
        <input type="month" value={from} max={m} onChange={e => setFrom(e.target.value)} aria-label="С месяца" />
        <input type="month" value={to} max={m} onChange={e => setTo(e.target.value)} aria-label="По месяц" />
      </div>
      <button className="save" onClick={() => onPick({ from: from || undefined, to: to || undefined })}>Показать {from || to ? `${from ? monthLabel(from) : '…'} — ${to ? monthLabel(to) : '…'}` : 'всё время'}</button>
    </Sheet>
  )
}

