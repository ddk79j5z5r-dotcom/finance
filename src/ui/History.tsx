import { useState } from 'react'
import { envelopePlan, envelopes, rootOf, spendRub, subEnvelopes } from '../domain/calc'
import { byOrder } from '../domain/categories'
import { monthLabel, monthOf, plural, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type IncomeKind, type Tx, type TxType } from '../domain/types'
import { LimitSheet } from './Budget'
import { Empty, Money, Sheet } from './common'
import { rootCategories, type Data } from './data'
import { Icon } from './icons'
import { categoryPath } from './Pickers'
import { CategoryRow, dayTitle, TxRow, TxSheet, txLook } from './rows'
import { useMonthSlide } from './nav'

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

type TypeFilter = 'all' | TxType

export function matches(data: Data, t: Tx, f: OpsFilter): boolean {
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

function periodLabel(f: OpsFilter) {
  if (!f.from && !f.to) return 'Всё время'
  if (f.from === f.to) return monthLabel(f.from!)
  return `${f.from ? monthLabel(f.from) : '…'} — ${f.to ? monthLabel(f.to) : '…'}`
}

export function History({ data, filter, setFilter }: { data: Data; filter: OpsFilter; setFilter: (f: OpsFilter) => void }) {
  const [open, setOpen] = useState<Tx | null>(null)
  const [type, setType] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [limit, setLimit] = useState(150)
  const [pick, setPick] = useState<'period' | 'account' | 'category' | 'income' | 'tag' | 'filters' | null>(null)
  const [limitOpen, setLimitOpen] = useState(false)

  const slide = useMonthSlide(`${filter.from ?? ''}|${filter.to ?? ''}`)
  const q = search.trim().toLowerCase()
  const qNum = q.replace(/\s/g, '').replace(',', '.')
  const all = [...data.txs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    // Возвраты показываются с расходами, корректировки — с переводами: ни то, ни другое не отдельный поток денег.
    .filter(t => type === 'all' || t.type === type || (type === 'expense' && t.type === 'refund') || (type === 'transfer' && t.type === 'adjust'))
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
    else if (t.type === 'expense' || t.type === 'refund') s.out += spendRub(t)
    else if (filter.accountId != null) { if (t.toAccountId === filter.accountId) s.in += t.toRub ?? t.rub; else s.out += t.rub }
    return s
  }, { in: 0, out: 0 })

  const single = filter.from && filter.from === filter.to ? filter.from : null
  const cat = filter.categoryId != null ? data.categories.find(c => c.id === filter.categoryId) : undefined
  const env0 = cat && cat.parentId == null && (cat.kind ?? 'expense') === 'expense' && single ? envelopes(data.categories, data.limits, data.txs, single).find(e => e.category.id === cat.id) : undefined
  const plan = env0 && envelopePlan(env0, subEnvelopes(data.categories, data.limits, data.txs, single!, env0.category.id!))
  const env = env0 && plan && { ...env0, limit: plan.limit, hasLimit: plan.hasLimit, available: plan.limit - env0.spent }
  const catKind = type === 'income' ? 'income' : 'expense'
  const reset = () => { setFilter({ from: filter.from, to: filter.to }); setType('all'); setSearch('') }
  const acc = filter.accountId != null ? data.accounts.find(a => a.id === filter.accountId) : undefined
  const filterCount = [filter.accountId != null, filter.categoryId != null || filter.noCategory, filter.tag, filter.incomeKind].filter(Boolean).length

  return (
    <div className="page ops-page">
      <div className="page-head">
        <h1>Операции</h1>
        <div className="head-actions">
          <button className={searchOpen ? 'icon-btn on' : 'icon-btn'} aria-label={searchOpen ? 'Скрыть поиск' : 'Поиск'} aria-expanded={searchOpen} onClick={() => { if (searchOpen) setSearch(''); setSearchOpen(v => !v) }}><Icon name="search" size={22} /></button>
          <button className={filterCount ? 'icon-btn on' : 'icon-btn'} style={{ position: 'relative' }} aria-label={filterCount ? `Фильтры: ${filterCount}` : 'Фильтры'} onClick={() => setPick('filters')}>
            <Icon name="tune" size={22} />{filterCount > 0 && <span className="badge-n">{filterCount}</span>}
          </button>
        </div>
      </div>
      {searchOpen && (
        <label className="search">
          <Icon name="search" size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Название, комментарий, сумма" aria-label="Поиск операций" autoComplete="off" enterKeyHint="search" autoFocus />
          {search && <button className="icon-btn" style={{ marginRight: '-0.6rem' }} aria-label="Очистить поиск" onClick={() => setSearch('')}><Icon name="close" size={14} /></button>}
        </label>
      )}

      <div className="ops-month">
        <button className="icon-btn" aria-label="Предыдущий месяц" disabled={!single} style={{ opacity: single ? 1 : 0.3 }} onClick={() => single && setFilter({ ...filter, from: shiftMonth(single, -1), to: shiftMonth(single, -1) })}><Icon name="left" size={20} /></button>
        <button className="ops-month-label" onClick={() => setPick('period')} aria-label={`Период: ${periodLabel(filter)}. Изменить`}>{periodLabel(filter)} <Icon name="down" size={18} stroke={2.4} /></button>
        <button className="icon-btn" aria-label="Следующий месяц" disabled={!single || single >= monthOf(todayISO())} style={{ opacity: single && single < monthOf(todayISO()) ? 1 : 0.3 }} onClick={() => single && setFilter({ ...filter, from: shiftMonth(single, 1), to: shiftMonth(single, 1) })}><Icon name="right" size={20} /></button>
      </div>

      <div className="tabs-line" role="tablist" aria-label="Тип операций">
        {([['all', 'Все'], ['expense', 'Расходы'], ['income', 'Доходы'], ['transfer', 'Переводы']] as const).map(([v, l]) => (
          <button key={v} role="tab" className={type === v ? 'on' : undefined} aria-selected={type === v} onClick={() => {
            setType(v)
            // Категория другого типа (доход ↔ расход) к новой выборке не подходит.
            if ((cat && (v === 'transfer' || (v === 'income') !== (cat.kind === 'income'))) || (filter.noCategory && v !== 'expense' && v !== 'all')) setFilter({ ...filter, categoryId: undefined, noCategory: undefined })
          }}>{l}</button>
        ))}
      </div>
      {filterCount > 0 && (
        <div className="chips" style={{ marginBottom: '0.5rem' }}>
          {acc && <button className="chip on" onClick={() => setFilter({ ...filter, accountId: undefined })} aria-label={`Убрать фильтр: ${acc.name}`}><span>{acc.name}</span><Icon name="close" size={11} /></button>}
          {(cat || filter.noCategory) && <button className="chip on" onClick={() => setFilter({ ...filter, categoryId: undefined, noCategory: undefined })} aria-label="Убрать фильтр категории"><span>{cat ? categoryPath(data.categories, cat.id) : 'Без категории'}</span><Icon name="close" size={11} /></button>}
          {filter.tag && <button className="chip on" onClick={() => setFilter({ ...filter, tag: undefined })} aria-label="Убрать фильтр метки"><span>#{filter.tag}</span><Icon name="close" size={11} /></button>}
          {filter.incomeKind && <button className="chip on" onClick={() => setFilter({ ...filter, incomeKind: undefined })}><span>{INCOME_LABEL[filter.incomeKind]}</span><Icon name="close" size={11} /></button>}
          <button className="chip clear" onClick={reset}>Сбросить всё</button>
        </div>
      )}

      <div ref={slide}>
      <div className="ops-sum" aria-live="polite">
        <span>{filter.accountId != null ? 'Ушло' : 'Расходы'} <b><Money v={totals.out} /></b></span>
        <i aria-hidden="true">·</i>
        <span>{filter.accountId != null ? 'Пришло' : 'Доходы'} <b><Money v={totals.in} /></b></span>
        {all.length > 0 && <span className="ops-count">{all.length} {plural(all.length, ['операция', 'операции', 'операций'])}</span>}
      </div>

      {env && (
        <div className="list">
          <CategoryRow e={env} onOpen={() => setLimitOpen(true)} categories={data.categories} note={plan?.fromSubs ? 'по подкатегориям' : undefined} />
          <button className="row noic" onClick={() => setLimitOpen(true)}><span className="body link">{env.hasLimit ? 'Изменить лимит' : 'Задать лимит'}</span></button>
        </div>
      )}

      {shown.length === 0 && (
        <div className="list">{data.txs.length
          ? <Empty title="Ничего не найдено">Измени период или сбрось фильтры.</Empty>
          : <Empty title="Операций пока нет">Нажми «+» внизу, чтобы записать первую.</Empty>}</div>
      )}
      {[...byDay].map(([day, list]) => (
        <section key={day} className="ops-day" aria-label={dayTitle(day)}>
          <h4>{dayTitle(day)}</h4>
          <div className="list">{list.map(t => <TxRow key={t.id} data={data} t={t} onOpen={setOpen} />)}</div>
        </section>
      ))}
      {all.length > limit && <button className="secondary" onClick={() => setLimit(l => l + 300)}>Показать ещё {Math.min(300, all.length - limit)}</button>}
      </div>

      {open && <TxSheet data={data} tx={open} onClose={() => setOpen(null)} />}
      {pick === 'period' && <PeriodSheet filter={filter} onPick={f => { setFilter({ ...filter, ...f }); setPick(null) }} onClose={() => setPick(null)} />}
      {pick === 'account' && (
        <PickSheet title="Счёт" value={filter.accountId ?? null} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все счета' }, ...data.accounts.filter(a => !a.archived).map(a => ({ value: a.id!, label: a.name }))]}
          onPick={v => { setFilter({ ...filter, accountId: v ?? undefined }); setPick(null) }} />
      )}
      {pick === 'category' && (
        <PickSheet title={catKind === 'income' ? 'Категория дохода' : 'Категория'} value={filter.noCategory ? -1 : filter.categoryId ?? null} onClose={() => setPick(null)}
          options={[
            { value: null, label: 'Все категории' },
            ...(catKind === 'expense' ? [{ value: -1, label: 'Без категории' }] : []),
            ...rootCategories(data.categories).filter(c => (c.kind ?? 'expense') === catKind).sort(byOrder).flatMap(c => [
              { value: c.id!, label: c.name },
              ...data.categories.filter(s => s.parentId === c.id && !s.archived).sort(byOrder).map(s => ({ value: s.id!, label: `${c.name} · ${s.name}`, indent: true })),
            ]),
          ]}
          onPick={v => { setFilter({ ...filter, categoryId: v == null || v === -1 ? undefined : v, noCategory: v === -1 || undefined, incomeKind: undefined }); setPick(null) }} />
      )}
      {pick === 'filters' && (
        <Sheet title="Фильтры" onClose={() => setPick(null)}>
          <div className="list">
            <button className="row noic" style={{ padding: '0 0.82rem' }} onClick={() => setPick('account')}><span className="body title">Счёт</span><span className="muted">{acc?.name ?? 'Все'}</span><Icon name="right" size={14} /></button>
            {type !== 'transfer' && <button className="row noic" style={{ padding: '0 0.82rem' }} onClick={() => setPick('category')}><span className="body title">Категория</span><span className="muted">{cat ? categoryPath(data.categories, cat.id) : filter.noCategory ? 'Без категории' : 'Все'}</span><Icon name="right" size={14} /></button>}
            {(data.settings.tags?.length ?? 0) > 0 && <button className="row noic" style={{ padding: '0 0.82rem' }} onClick={() => setPick('tag')}><span className="body title">Метка</span><span className="muted">{filter.tag ? `#${filter.tag}` : 'Все'}</span><Icon name="right" size={14} /></button>}
          </div>
          {filterCount > 0 && <button className="secondary" onClick={() => { reset(); setPick(null) }}>Сбросить фильтры</button>}
        </Sheet>
      )}
      {pick === 'tag' && (
        <PickSheet title="Метка" value={filter.tag ?? null} onClose={() => setPick(null)}
          options={[{ value: null, label: 'Все' }, ...(data.settings.tags ?? []).map(t => ({ value: t, label: `#${t}` }))]}
          onPick={v => { setFilter({ ...filter, tag: v ?? undefined }); setPick(null) }} />
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

