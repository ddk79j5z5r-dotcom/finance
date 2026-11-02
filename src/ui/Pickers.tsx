import { useMemo, useState, type ReactNode } from 'react'
import { db } from '../db'
import { byOrder, kindOf, nameTaken } from '../domain/categories'
import type { Category, CategoryKind } from '../domain/types'
import { Empty, Section, Sheet } from './common'
import type { Data } from './data'
import { CATEGORY_COLORS, CatBadge, Icon } from './icons'

/** Строка выбора «Откуда / Куда»: значок, подпись, значение, справа — доп. информация и стрелка. */
export function PickRow({ icon, label, value, extra, onClick, empty = false }: {
  icon: ReactNode; label: string; value: string; extra?: ReactNode; onClick: () => void; empty?: boolean
}) {
  return (
    <button type="button" className={empty ? 'acc-pick empty' : 'acc-pick'} onClick={onClick} aria-label={`${label}: ${value}`}>
      {icon}
      <span className="body"><span className="k">{label}</span><span className="v">{value}</span></span>
      {extra && <span className="bal">{extra}</span>}
      <Icon name="right" size={18} />
    </button>
  )
}

/** Полное название: «Родитель · Подкатегория». */
export function categoryPath(categories: Category[], id: number | null | undefined) {
  const c = categories.find(x => x.id === id)
  if (!c) return ''
  const p = c.parentId != null ? categories.find(x => x.id === c.parentId) : undefined
  return p ? `${p.name} · ${c.name}` : c.name
}

/**
 * Выбор категории расхода или дохода. Сначала избранные и недавние, затем все основные категории;
 * поиск — по всему справочнику; подкатегории — после выбора родителя (можно оставить только родителя).
 * Можно создать категорию прямо отсюда; архивные не показываются. Для расходов — «Без категории».
 */
export function CategoryPicker({ data, kind, value, onPick, open, setOpen, label = 'Куда', allowNone = false, noneChosen = false }: {
  data: Data; kind: CategoryKind; value: number | null; onPick: (id: number | null) => void
  open: boolean; setOpen: (v: boolean) => void; label?: string; allowNone?: boolean
  /** Пользователь явно выбрал «Без категории». */
  noneChosen?: boolean
}) {
  const [step, setStep] = useState<Category | null>(null)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null)
  const cats = data.categories
  const live = (c: Category) => !c.archived && !c.system && kindOf(c) === kind
  const roots = useMemo(() => cats.filter(c => c.parentId == null && live(c)).sort(byOrder), [cats, kind]) // eslint-disable-line
  const children = (id: number) => cats.filter(c => c.parentId === id && live(c)).sort(byOrder)
  const chosen = cats.find(c => c.id === value)
  const close = () => { setOpen(false); setStep(null); setQ(''); setCreating(null) }
  const pick = (id: number | null) => { onPick(id); close() }

  // Недавние — по последним операциям этого типа.
  const recent = useMemo(() => {
    const type = kind === 'income' ? 'income' : 'expense'
    const seen: number[] = []
    for (const t of [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
      if (t.type !== type || t.categoryId == null || seen.includes(t.categoryId)) continue
      const c = cats.find(x => x.id === t.categoryId)
      if (c && live(c)) seen.push(t.categoryId)
      if (seen.length >= 6) break
    }
    return seen
  }, [data.txs, cats, kind]) // eslint-disable-line
  const favorites = cats.filter(c => c.favorite && live(c)).sort(byOrder)
  const found = q.trim()
    ? cats.filter(c => live(c) && (c.parentId == null || live(cats.find(p => p.id === c.parentId) ?? c)) && categoryPath(cats, c.id).toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru')))
      .sort((a, b) => categoryPath(cats, a.id).localeCompare(categoryPath(cats, b.id), 'ru')).slice(0, 40)
    : []

  const chip = (id: number) => {
    const c = cats.find(x => x.id === id)!
    return (
      <button key={id} type="button" className={id === value ? 'chip on' : 'chip'} onClick={() => pick(id)}>
        <CatBadge categories={cats} c={c} size={20} /><span>{categoryPath(cats, id)}</span>
      </button>
    )
  }

  return (
    <>
      <PickRow
        icon={chosen ? <CatBadge categories={cats} c={chosen} size={36} /> : <span className="badge tone-transfer" style={{ width: 36, height: 36 }}><Icon name="tag" size={18} /></span>}
        label={label} value={chosen ? categoryPath(cats, chosen.id) : allowNone && noneChosen ? 'Без категории' : 'Выбери категорию'} empty={!chosen && !noneChosen}
        onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={creating ? 'Новая категория' : step ? step.name : kind === 'income' ? 'Категория дохода' : 'Категория'} onClose={close}>
          {creating ? (
            <NewCategory data={data} kind={kind} parentId={creating.parentId} onDone={id => (id != null ? pick(id) : setCreating(null))} />
          ) : step ? (
            <>
              <div className="list">
                <button className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => pick(step.id!)}>
                  <CatBadge categories={cats} c={step} />
                  <span className="body title">Только «{step.name}»</span>
                  {value === step.id && <Icon name="check" size={18} />}
                </button>
                {children(step.id!).map(c => (
                  <button key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => pick(c.id!)}>
                    <span style={{ width: 30 }} />
                    <span className="body title">{c.name}</span>
                    {value === c.id && <Icon name="check" size={18} />}
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <button className="secondary" onClick={() => setStep(null)}><Icon name="left" size={16} /> Назад</button>
                <button className="secondary" onClick={() => setCreating({ parentId: step.id! })}>+ Подкатегория</button>
              </div>
            </>
          ) : (
            <>
              <label className="search">
                <Icon name="search" size={16} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по категориям" aria-label="Поиск по категориям" autoComplete="off" enterKeyHint="search" />
              </label>
              {q.trim() ? (
                <div className="list">
                  {found.length === 0 && <Empty title="Ничего не найдено"><button className="link" onClick={() => setCreating({ parentId: null })}>Создать «{q.trim()}»</button></Empty>}
                  {found.map(c => (
                    <button key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => pick(c.id!)}>
                      <CatBadge categories={cats} c={c} />
                      <span className="body title">{categoryPath(cats, c.id)}</span>
                      {value === c.id && <Icon name="check" size={18} />}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {favorites.length > 0 && <><Section title="Избранные" /><div className="chips">{favorites.map(c => chip(c.id!))}</div></>}
                  {recent.length > 0 && <><Section title="Недавние" /><div className="chips">{recent.filter(id => !favorites.some(f => f.id === id)).map(chip)}</div></>}
                  <Section title="Все категории" />
                  {roots.length === 0 && <Empty title="Категорий пока нет">Создай первую — кнопкой ниже.</Empty>}
                  <div className="tile-grid">
                    {roots.map(c => {
                      const kids = children(c.id!).length
                      const on = c.id === value || cats.find(x => x.id === value)?.parentId === c.id
                      return (
                        <button key={c.id} type="button" className={on ? 'tile-btn on' : 'tile-btn'} onClick={() => (kids ? setStep(c) : pick(c.id!))}>
                          <CatBadge categories={cats} c={c} size={46} />
                          <span className="tile-label">{c.name}{kids > 0 && ' ›'}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="btn-row">
                    <button className="secondary" onClick={() => setCreating({ parentId: null })}>+ Новая категория</button>
                    {allowNone && <button className="secondary" onClick={() => pick(null)}>Без категории</button>}
                  </div>
                </>
              )}
            </>
          )}
        </Sheet>
      )}
    </>
  )
}

/** Быстрое создание категории из формы операции: название и (необязательно) родитель; дубли у родителя не пропускаются. */
function NewCategory({ data, kind, parentId, onDone }: { data: Data; kind: CategoryKind; parentId: number | null; onDone: (id: number | null) => void }) {
  const [name, setName] = useState('')
  const [parent, setParent] = useState<number | null>(parentId)
  const [error, setError] = useState('')
  const roots = data.categories.filter(c => c.parentId == null && !c.archived && !c.system && kindOf(c) === kind).sort(byOrder)
  const save = async () => {
    const n = name.trim()
    if (!n) return setError('Введи название')
    const twin = nameTaken(data.categories, n, parent, kind)
    if (twin) return twin.archived ? setError(`«${twin.name}» уже есть в архиве — восстанови её в «Ещё → Категории»`) : onDone(twin.id!)
    const p = data.categories.find(c => c.id === parent)
    const order = Math.max(-1, ...data.categories.filter(c => c.parentId === parent && kindOf(c) === kind).map(c => c.order ?? 0)) + 1
    const id = await db.categories.add({ name: n, parentId: parent, bucket: p?.bucket ?? 'needs', archived: false, kind, order, ...(parent == null ? { color: CATEGORY_COLORS[roots.length % CATEGORY_COLORS.length] } : {}) })
    onDone(id ?? null)
  }
  return (
    <>
      <label className="field-label" htmlFor="new-cat">Название</label>
      <input id="new-cat" value={name} onChange={e => { setName(e.target.value); setError('') }} autoFocus enterKeyHint="done" />
      <label className="field-label" htmlFor="new-cat-parent">Родитель</label>
      <select id="new-cat-parent" value={parent ?? ''} onChange={e => setParent(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— основная категория —</option>
        {roots.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {error && <p className="error">{error}</p>}
      <button className="save" onClick={save}>Создать и выбрать</button>
      <button className="secondary" onClick={() => onDone(null)}>Назад</button>
    </>
  )
}
