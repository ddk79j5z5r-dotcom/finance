import { useEffect, useMemo, useState } from 'react'
import { db, saveSettings } from '../db'
import { byOrder, CategoryError, deleteCategories, kindOf, mergeCategory, moveCategory, nameTaken, removeOrArchive, withChildren } from '../domain/categories'
import { plural } from '../domain/money'
import type { Category, CategoryKind } from '../domain/types'
import { Empty, Section, Segmented, Sheet, useOnce } from './common'
import type { Data } from './data'
import { Badge, CATEGORY_COLORS, CATEGORY_ICONS, CatBadge, categoryLook, Icon } from './icons'
import { categoryPath } from '../domain/ops'
import { notify } from './undo'

const opsWord = (n: number) => `${n} ${plural(n, ['операция', 'операции', 'операций'])}`

/** Справочник категорий: расходы и доходы, группы с подкатегориями, порядок, вид, архив, перенос и объединение. */
export function Categories({ data }: { data: Data }) {
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [edit, setEdit] = useState<Partial<Category> | null>(null)
  const [cleanup, setCleanup] = useState<'archive' | 'starter' | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const cats = data.categories
  // Раздел открыли — пункт «Проверить категории» в настройке считается выполненным.
  useEffect(() => { if (!data.settings.categoriesReviewed) saveSettings({ categoriesReviewed: true }) }, [data.settings.categoriesReviewed])

  const mine = cats.filter(c => !c.system && kindOf(c) === kind)
  const roots = mine.filter(c => c.parentId == null && !c.archived).sort(byOrder)
  const kids = (id: number, archived = false) => mine.filter(c => c.parentId === id && !!c.archived === archived).sort(byOrder)
  const archived = mine.filter(c => c.archived && (c.parentId == null || !cats.find(p => p.id === c.parentId)?.archived)).sort((a, b) => categoryPath(cats, a.id).localeCompare(categoryPath(cats, b.id), 'ru'))
  const count = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of data.txs) if (t.categoryId != null) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1)
    return m
  }, [data.txs])
  // Категории, которые когда-то добавило само приложение (готовый справочник), — без операций, лимитов и платежей.
  const used = (id: number) => withChildren(cats, id).some(x => (count.get(x) ?? 0) > 0 || data.limits.some(l => l.categoryId === x) || data.recurring.some(r => r.categoryId === x))
  const unusedStarter = mine.filter(c => c.key && c.parentId == null && !used(c.id!))
  const found = q.trim() ? mine.filter(c => categoryPath(cats, c.id).toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru'))).sort((a, b) => categoryPath(cats, a.id).localeCompare(categoryPath(cats, b.id), 'ru')) : []
  const toggle = (id: number) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  /** Сдвиг вверх/вниз среди соседей: порядок пересчитывается для всех соседей, чтобы не было совпадений. */
  const shift = async (c: Category, dir: -1 | 1) => {
    const sibs = mine.filter(x => x.parentId === c.parentId && !x.archived).sort(byOrder)
    const i = sibs.findIndex(x => x.id === c.id), j = i + dir
    if (j < 0 || j >= sibs.length) return
    ;[sibs[i], sibs[j]] = [sibs[j], sibs[i]]
    await db.transaction('rw', db.categories, () => Promise.all(sibs.map((x, k) => db.categories.update(x.id!, { order: k }))))
  }

  const subRow = (c: Category) => (
    <button key={c.id} className="row" style={{ padding: '0.36rem 0.82rem 0.36rem 3.1rem' }} onClick={() => setEdit(c)}>
      <span className="body"><span className="title">{c.name}{c.favorite && ' ★'}</span></span>
      {(count.get(c.id!) ?? 0) > 0 && <span className="muted small">{count.get(c.id!)}</span>}
      <Icon name="right" size={14} />
    </button>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1>Категории</h1>
        {!q.trim() && roots.length > 1 && <button className="menu-chip" aria-pressed={ordering} onClick={() => setOrdering(v => !v)}>{ordering ? 'Готово' : 'Порядок'}</button>}
      </div>
      <Segmented value={kind} onChange={v => { setKind(v); setQ('') }} options={[{ value: 'expense', label: 'Расходы' }, { value: 'income', label: 'Доходы' }]} />
      <label className="search" style={{ marginTop: '0.6rem' }}>
        <Icon name="search" size={16} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по категориям" aria-label="Поиск по категориям" autoComplete="off" enterKeyHint="search" />
      </label>

      {!q.trim() && unusedStarter.length > 0 && (
        <button className="card tight row" style={{ marginTop: '0.6rem', padding: '0.6rem 0.82rem' }} onClick={() => setCleanup('starter')}>
          <span className="menu-ico" style={{ background: 'var(--s3)', color: 'var(--text)' }}><Icon name="close" size={14} /></span>
          <span className="body"><span className="title">Убрать готовые без операций</span><span className="sub wrap">{unusedStarter.length} {plural(unusedStarter.length, ['группа', 'группы', 'групп'])}, добавленных приложением: {unusedStarter.slice(0, 3).map(c => c.name).join(', ')}{unusedStarter.length > 3 ? '…' : ''}</span></span>
          <Icon name="right" size={16} />
        </button>
      )}

      {q.trim() ? (
        <div className="list" style={{ marginTop: '0.6rem' }}>
          {found.length === 0 && <Empty title="Ничего не найдено"><button className="link" onClick={() => setEdit({ name: q.trim(), parentId: null, kind })}>Создать «{q.trim()}»</button></Empty>}
          {found.map(c => (
            <button key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => setEdit(c)}>
              <CatBadge categories={cats} c={c} />
              <span className="body"><span className="title">{categoryPath(cats, c.id)}</span>{c.archived && <span className="sub">в архиве</span>}</span>
              <Icon name="right" size={14} />
            </button>
          ))}
        </div>
      ) : (
        <>
          <Section title={kind === 'expense' ? 'Категории расходов' : 'Категории доходов'} extra={<button className="link" onClick={() => setEdit({ parentId: null, kind })}>+ Категория</button>} />
          {roots.length === 0 ? (
            <Empty title="Категорий пока нет">Добавь свою или выбери из готовых.</Empty>
          ) : (
            <div className="list">
              {roots.map((c, i) => {
                const subs = kids(c.id!)
                const total = withChildren(cats, c.id!).reduce((s, id) => s + (count.get(id) ?? 0), 0)
                const isOpen = open.has(c.id!)
                return (
                  <div key={c.id}>
                    <div className="row" style={{ padding: '0.36rem 0.5rem 0.36rem 0.82rem' }}>
                      <button className="row-main" style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => setEdit(c)}>
                        <CatBadge categories={cats} c={c} size={34} />
                        <span className="body"><span className="title wrap">{c.name}{c.favorite && ' ★'}</span><span className="sub wrap">{subs.length ? `${subs.length} ${plural(subs.length, ['подкатегория', 'подкатегории', 'подкатегорий'])}` : 'без подкатегорий'}{total ? ` · ${opsWord(total)}` : ''}</span></span>
                      </button>
                      {ordering ? (
                        <>
                          <button className="icon-btn" aria-label={`«${c.name}» выше`} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => shift(c, -1)}><Icon name="up" size={16} /></button>
                          <button className="icon-btn" aria-label={`«${c.name}» ниже`} disabled={i === roots.length - 1} style={{ opacity: i === roots.length - 1 ? 0.3 : 1 }} onClick={() => shift(c, 1)}><Icon name="down" size={16} /></button>
                        </>
                      ) : (
                        <button className="icon-btn" aria-label={isOpen ? `Свернуть «${c.name}»` : `Подкатегории «${c.name}»`} aria-expanded={isOpen} onClick={() => toggle(c.id!)}>
                          <span style={{ display: 'inline-flex', transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}><Icon name="down" size={16} /></span>
                        </button>
                      )}
                    </div>
                    {isOpen && !ordering && (
                      <>
                        {subs.map(subRow)}
                        <button className="row" style={{ padding: '0 0.82rem 0 3.1rem', minHeight: '2.6rem' }} onClick={() => setEdit({ parentId: c.id!, kind })}><span className="body link">+ Подкатегория</span></button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {archived.length > 0 && (
            <>
              <Section title="Архив" extra={<button className="link" onClick={() => setShowArchive(v => !v)}>{showArchive ? 'Скрыть' : `Показать · ${archived.length}`}</button>} />
              {showArchive && (
                <div className="list">
                  {archived.map(c => (
                    <button key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => setEdit(c)}>
                      <CatBadge categories={cats} c={c} />
                      <span className="body"><span className="title">{categoryPath(cats, c.id)}</span><span className="sub">{opsWord(withChildren(cats, c.id!).reduce((s, id) => s + (count.get(id) ?? 0), 0))} в истории</span></span>
                      <Icon name="right" size={14} />
                    </button>
                  ))}
                </div>
              )}
              <p className="hint">Архивные категории не предлагаются при вводе, но остаются в истории и отчётах.</p>
              <button className="danger" onClick={() => setCleanup('archive')}>Удалить архив</button>
            </>
          )}
        </>
      )}

      {edit && <CategoryEditor data={data} cat={edit} count={count} onClose={() => setEdit(null)} />}
      {cleanup && (() => {
        const list = cleanup === 'archive' ? archived : unusedStarter
        const ops = list.reduce((s, c) => s + withChildren(cats, c.id!).reduce((a, id) => a + (count.get(id) ?? 0), 0), 0)
        const subs = list.reduce((s, c) => s + withChildren(cats, c.id!).length - 1, 0)
        return (
          <Sheet title={cleanup === 'archive' ? 'Удалить архив?' : 'Убрать готовые категории?'} onClose={() => setCleanup(null)}>
            <div className="list">
              {list.map(c => <div key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }}><CatBadge categories={cats} c={c} /><span className="body title">{categoryPath(cats, c.id)}</span></div>)}
            </div>
            <ul className="hint" style={{ paddingLeft: '1.2rem' }}>
              <li>Удаляются насовсем: {list.length} {plural(list.length, ['категория', 'категории', 'категорий'])}{subs ? ` и ${subs} ${plural(subs, ['подкатегория', 'подкатегории', 'подкатегорий'])}` : ''}.</li>
              {ops > 0 ? <li>Остаются в истории, но без категории: {opsWord(ops)}.</li> : <li>Операций в них нет.</li>}
              <li>Отменить нельзя — перед этим можно сделать бэкап в Excel.</li>
            </ul>
            <button className="danger" onClick={async () => {
              const n = await deleteCategories(db, list.map(c => c.id!))
              setCleanup(null)
              notify(`Удалено: ${list.length} ${plural(list.length, ['категория', 'категории', 'категорий'])}${n ? `, ${opsWord(n)} без категории` : ''}`)
            }}>Удалить</button>
            <button className="secondary" onClick={() => setCleanup(null)}>Отмена</button>
          </Sheet>
        )
      })()}
    </div>
  )
}

/** Карточка категории: название, вид, избранное, счёт по умолчанию; перенос, объединение, архив и восстановление. */
function CategoryEditor({ data, cat, count, onClose }: { data: Data; cat: Partial<Category>; count: Map<number, number>; onClose: () => void }) {
  const cats = data.categories
  const kind = kindOf(cat as Category)
  const isNew = cat.id == null
  const isSub = cat.parentId != null
  const parent = cats.find(c => c.id === cat.parentId)
  const [name, setName] = useState(cat.name ?? '')
  const [icon, setIcon] = useState<string | undefined>(cat.icon)
  const [color, setColor] = useState<string | undefined>(cat.color)
  const [favorite, setFavorite] = useState(!!cat.favorite)
  const [accountId, setAccountId] = useState<number | null>(cat.accountId ?? null)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'edit' | 'move' | 'merge'>('edit')
  const [mergeTo, setMergeTo] = useState<Category | null>(null)
  const look = categoryLook(cats, { ...(cat as Category), name, icon, color })
  const ops = cat.id != null ? withChildren(cats, cat.id).reduce((s, id) => s + (count.get(id) ?? 0), 0) : 0
  const kidsCount = cat.id != null ? cats.filter(c => c.parentId === cat.id).length : 0
  const hasLimits = cat.id != null && withChildren(cats, cat.id).some(id => data.limits.some(l => l.categoryId === id))
  const hasRecurring = cat.id != null && withChildren(cats, cat.id).some(id => data.recurring.some(r => r.categoryId === id))
  const used = ops > 0 || hasLimits || hasRecurring

  const save = useOnce(async () => {
    const n = name.trim()
    if (!n) return setError('Введи название')
    const twin = nameTaken(cats, n, cat.parentId ?? null, kind, cat.id)
    if (twin) return setError(twin.archived ? `«${twin.name}» уже есть в архиве — восстанови её` : `«${twin.name}» уже есть${parent ? ` в «${parent.name}»` : ''}`)
    const order = cat.order ?? Math.max(-1, ...cats.filter(c => c.parentId === (cat.parentId ?? null) && kindOf(c) === kind).map(c => c.order ?? 0)) + 1
    const rootColor = !isSub && !color && isNew ? CATEGORY_COLORS[cats.filter(c => c.parentId == null).length % CATEGORY_COLORS.length] : color
    await db.categories.put({
      ...(cat as Category), name: n, icon, color: rootColor, favorite: favorite || undefined, accountId, kind, order,
      parentId: cat.parentId ?? null, archived: cat.archived ?? false, bucket: cat.bucket ?? parent?.bucket ?? 'needs',
    })
    onClose()
  })
  const archive = useOnce(async () => {
    const r = await removeOrArchive(db, cat.id!)
    onClose()
    if (r === 'archived') notify(`«${cat.name}» в архиве`, async () => { await db.categories.where('id').anyOf(withChildren(await db.categories.toArray(), cat.id!)).modify({ archived: false }) })
    else notify(`«${cat.name}» удалена`)
  })
  const restore = useOnce(async () => {
    await db.transaction('rw', db.categories, async () => {
      const all = await db.categories.toArray()
      // Подкатегория восстанавливается вместе с родителем; основная — со своими подкатегориями.
      const ids = cat.parentId != null ? [cat.id!, cat.parentId] : withChildren(all, cat.id!)
      await db.categories.where('id').anyOf(ids).modify({ archived: false })
    })
    onClose()
    notify(`«${cat.name}» восстановлена`)
  })
  const move = async (to: number) => {
    try { await moveCategory(db, cat.id!, to); onClose(); notify(`«${cat.name}» перенесена`) }
    catch (e) { setError(e instanceof CategoryError ? e.message : 'Не получилось перенести'); setStep('edit') }
  }
  const merge = useOnce(async () => {
    try {
      const r = await mergeCategory(db, cat.id!, mergeTo!.id!)
      onClose()
      notify(`Объединено: ${opsWord(r.txs)} в «${categoryPath(cats, mergeTo!.id)}»`)
    } catch (e) { setError(e instanceof CategoryError ? e.message : 'Не получилось объединить'); setMergeTo(null); setStep('edit') }
  })

  const title = isNew ? (isSub ? `Подкатегория в «${parent?.name}»` : 'Новая категория') : categoryPath(cats, cat.id)

  if (mergeTo) {
    const targetHasLimits = data.limits.some(l => l.categoryId === mergeTo.id)
    return (
      <Sheet title="Объединить?" onClose={onClose}>
        <div className="list">
          <div className="row" style={{ padding: '0.5rem 0.82rem' }}><CatBadge categories={cats} c={cat as Category} /><span className="body title">{categoryPath(cats, cat.id)}</span></div>
          <div className="row noic" style={{ padding: '0 0.82rem', minHeight: '1.8rem', justifyContent: 'center' }}><Icon name="down" size={16} /></div>
          <div className="row" style={{ padding: '0.5rem 0.82rem' }}><CatBadge categories={cats} c={mergeTo} /><span className="body title">{categoryPath(cats, mergeTo.id)}</span></div>
        </div>
        <ul className="hint" style={{ paddingLeft: '1.2rem' }}>
          <li>{ops ? `${opsWord(ops)} перейдут в «${mergeTo.name}»` : 'Операций нет'}</li>
          {kidsCount > 0 && <li>{kidsCount} {plural(kidsCount, ['подкатегория', 'подкатегории', 'подкатегорий'])} перейдут к «{mergeTo.name}», одноимённые сольются</li>}
          {hasLimits && <li>{targetHasLimits ? `Лимиты «${cat.name}» будут сняты — у «${mergeTo.name}» есть свои, бюджет не увеличится` : `Лимиты «${cat.name}» перейдут к «${mergeTo.name}»`}</li>}
          {hasRecurring && <li>Регулярные платежи перейдут в «{mergeTo.name}»</li>}
          <li>«{cat.name}» будет удалена. Отменить нельзя.</li>
        </ul>
        <button className="save" onClick={merge}>Объединить</button>
        <button className="secondary" onClick={() => setMergeTo(null)}>Отмена</button>
      </Sheet>
    )
  }

  if (step !== 'edit') {
    // Перенос — только подкатегории к другой основной; объединение — с любой категорией того же типа, кроме своих.
    const own = cat.id != null ? withChildren(cats, cat.id) : []
    const targets = cats.filter(c => !c.system && !c.archived && kindOf(c) === kind && !own.includes(c.id!)
      && (step === 'move' ? c.parentId == null && c.id !== cat.parentId : kidsCount === 0 || c.parentId == null))
      .sort((a, b) => categoryPath(cats, a.id).localeCompare(categoryPath(cats, b.id), 'ru'))
    return (
      <Sheet title={step === 'move' ? `Перенести «${cat.name}» в` : `Объединить «${cat.name}» с`} onClose={onClose}>
        <div className="list">
          {targets.map(c => (
            <button key={c.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => (step === 'move' ? move(c.id!) : setMergeTo(c))}>
              <CatBadge categories={cats} c={c} />
              <span className="body title">{categoryPath(cats, c.id)}</span>
            </button>
          ))}
          {targets.length === 0 && <Empty title="Подходящих категорий нет" />}
        </div>
        <button className="secondary" onClick={() => setStep('edit')}>Назад</button>
      </Sheet>
    )
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '0.2rem 0 0.6rem' }}><Badge icon={look.icon} color={look.color} size={56} /></div>
      <label className="field-label" htmlFor="cat-name">Название</label>
      <input id="cat-name" value={name} onChange={e => { setName(e.target.value); setError('') }} autoFocus={isNew} enterKeyHint="done" />
      {!isSub && (
        <>
          <label className="field-label">Цвет</label>
          <div className="chips" role="radiogroup" aria-label="Цвет">
            {CATEGORY_COLORS.map(c => (
              <button key={c} type="button" role="radio" aria-checked={look.color === c} aria-label={c} onClick={() => setColor(c)}
                style={{ width: 32, height: 32, borderRadius: 16, background: c, border: look.color === c ? '3px solid var(--text)' : '3px solid transparent', padding: 0 }} />
            ))}
          </div>
          <label className="field-label">Иконка {!icon && <span className="muted">· подобрана по названию</span>}</label>
          <div className="tile-grid icon-grid">
            {CATEGORY_ICONS.map(i => (
              <button key={i} type="button" className={i === look.icon ? 'tile-btn on' : 'tile-btn'} aria-label={i} aria-pressed={i === look.icon} onClick={() => setIcon(i)}>
                <Badge icon={i} color={look.color} size={40} />
              </button>
            ))}
          </div>
        </>
      )}
      <label className="check-line" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: 44 }}>
        <input type="checkbox" checked={favorite} onChange={e => setFavorite(e.target.checked)} /> Избранная — первой при вводе
      </label>
      {kind === 'expense' && (
        <>
          <label className="field-label" htmlFor="cat-acc">Счёт по умолчанию</label>
          <select id="cat-acc" value={accountId ?? ''} onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{isSub ? 'Как у родительской категории' : 'Основной счёт'}</option>
            {data.accounts.filter(a => !a.archived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </>
      )}
      {!isNew && <p className="hint">{ops ? `${opsWord(ops)}. ` : 'Операций нет. '}Переименование не меняет историю — операции связаны с категорией, а не с названием.</p>}
      {error && <p className="error">{error}</p>}
      {cat.archived ? (
        <button className="save" onClick={restore}>Восстановить</button>
      ) : (
        <button className="save" onClick={save}>{isNew ? 'Создать' : 'Сохранить'}</button>
      )}
      {!isNew && !cat.archived && (
        <div className="btn-row">
          {isSub && <button className="secondary" onClick={() => setStep('move')}>Перенести</button>}
          <button className="secondary" onClick={() => setStep('merge')}>Объединить</button>
        </div>
      )}
      {!isNew && <button className="danger" onClick={archive}>{used ? (cat.archived ? 'Уже в архиве' : 'В архив') : 'Удалить'}</button>}
      {!isNew && used && !cat.archived && <p className="hint">Категорию с операциями нельзя удалить без следа — она уйдёт в архив. Чтобы перенести её операции в другую категорию, используй «Объединить».</p>}
    </Sheet>
  )
}
