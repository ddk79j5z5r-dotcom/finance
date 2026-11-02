import type { FinanceDB } from '../db'
import type { Category, CategoryKind, IncomeKind } from './types'

// ---------- Справочник категорий ----------

/** Тип категории: у старых записей не задан — это расходы. */
export const kindOf = (c: Pick<Category, 'kind'>): CategoryKind => c.kind ?? 'expense'

const norm = (s: string) => s.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ')

// ---------- Доходы: вид дохода для расчётов по выплатам ----------

/**
 * Вид дохода по названию категории (и её родителя): зарплата и аванс нужны для «Доступно до дохода» и календаря выплат.
 * Справочник свой, поэтому — по словам в названии: «Зарплата», «Аванс», «Премия», «Купоны», «Подарки».
 */
export function incomeKindFor(categories: Category[], id: number | null | undefined): IncomeKind {
  const c = categories.find(x => x.id === id)
  if (!c) return 'other'
  const parent = c.parentId != null ? categories.find(x => x.id === c.parentId) : undefined
  for (const name of [c.name, parent?.name ?? '']) {
    const n = norm(name)
    if (/аванс/.test(n)) return 'advance'
    if (/зарплат|заработн|оклад/.test(n)) return 'salary'
    if (/прем/.test(n)) return 'bonus'
    if (/купон|дивиденд|процент|вклад|инвест/.test(n)) return 'interest'
    if (/подар|родител/.test(n)) return 'gift'
  }
  return 'other'
}

// ---------- Правка справочника ----------

/** Название уже занято у этого родителя (без учёта регистра и «ё»). */
export function nameTaken(categories: Category[], name: string, parentId: number | null, kind: CategoryKind, exceptId?: number): Category | undefined {
  return categories.find(c => c.id !== exceptId && !c.system && c.parentId === parentId && kindOf(c) === kind && norm(c.name) === norm(name))
}

/** Категория и все её подкатегории. */
export const withChildren = (categories: Category[], id: number) => [id, ...categories.filter(c => c.parentId === id).map(c => c.id!)]

/** Сколько операций, платежей и лимитов связано с категорией (с подкатегориями). */
export async function usage(db: FinanceDB, id: number) {
  const cats = await db.categories.toArray()
  const ids = withChildren(cats, id)
  const [txs, rec, lim] = await Promise.all([
    db.txs.where('categoryId').anyOf(ids).count(),
    db.recurring.filter(r => ids.includes(r.categoryId)).count(),
    db.limits.where('categoryId').anyOf(ids).count(),
  ])
  return { txs, recurring: rec, limits: lim, children: ids.length - 1 }
}

export class CategoryError extends Error {}

/** Перенос подкатегории к другому родителю того же типа. Совпадение названия у нового родителя — ошибка (предложить объединение). */
export async function moveCategory(db: FinanceDB, id: number, parentId: number) {
  await db.transaction('rw', db.categories, async () => {
    const cats = await db.categories.toArray()
    const c = cats.find(x => x.id === id), p = cats.find(x => x.id === parentId)
    if (!c || !p) throw new CategoryError('Категория не найдена')
    if (c.parentId == null && cats.some(x => x.parentId === id)) throw new CategoryError('У категории есть подкатегории — её нельзя сделать подкатегорией')
    if (p.parentId != null) throw new CategoryError('Переносить можно только в основную категорию')
    if (kindOf(c) !== kindOf(p)) throw new CategoryError('Нельзя переносить между доходами и расходами')
    if (nameTaken(cats, c.name, parentId, kindOf(c), id)) throw new CategoryError(`В «${p.name}» уже есть «${c.name}» — их можно объединить`)
    const order = Math.max(-1, ...cats.filter(x => x.parentId === parentId).map(x => x.order ?? 0)) + 1
    await db.categories.update(id, { parentId, order })
  })
}

/**
 * Объединение: операции, регулярные платежи и подкатегории источника переходят в цель, источник удаляется.
 * Лимиты: если у цели своих лимитов нет — переходят лимиты источника, иначе лимиты источника снимаются
 * (бюджет цели не увеличивается сам собой). Всё в одной транзакции.
 */
export async function mergeCategory(db: FinanceDB, fromId: number, toId: number): Promise<{ txs: number }> {
  if (fromId === toId) throw new CategoryError('Нельзя объединить категорию саму с собой')
  let moved = 0
  await db.transaction('rw', db.categories, db.txs, db.limits, db.recurring, async () => {
    const cats = await db.categories.toArray()
    // Затронутые операции — источника и его подкатегорий (у них меняется родитель или сама категория).
    moved = await db.txs.where('categoryId').anyOf(withChildren(cats, fromId)).count()
    const from = cats.find(c => c.id === fromId), to = cats.find(c => c.id === toId)
    if (!from || !to) throw new CategoryError('Категория не найдена')
    if (kindOf(from) !== kindOf(to)) throw new CategoryError('Нельзя объединять доходы и расходы')
    if (to.parentId === fromId) throw new CategoryError('Нельзя объединить категорию со своей подкатегорией')
    const children = cats.filter(c => c.parentId === fromId)
    if (children.length && to.parentId != null) throw new CategoryError('Категорию с подкатегориями можно объединить только с основной категорией')
    // Подкатегории: к цели; совпадающие по названию — сливаются с существующими.
    for (const ch of children) {
      const twin = nameTaken(cats, ch.name, toId, kindOf(to), ch.id)
      if (twin) await mergeInto(db, ch.id!, twin.id!)
      else await db.categories.update(ch.id!, { parentId: toId })
    }
    await mergeInto(db, fromId, toId)
  })
  return { txs: moved }
}

async function mergeInto(db: FinanceDB, fromId: number, toId: number): Promise<number> {
  const moved = await db.txs.where('categoryId').equals(fromId).modify({ categoryId: toId })
  await db.recurring.filter(r => r.categoryId === fromId).modify({ categoryId: toId })
  const targetHasLimits = (await db.limits.where('categoryId').equals(toId).count()) > 0
  if (targetHasLimits) await db.limits.where('categoryId').equals(fromId).delete()
  else await db.limits.where('categoryId').equals(fromId).modify({ categoryId: toId })
  await db.categories.delete(fromId)
  return moved
}

/** Удалить можно только неиспользуемую категорию; используемую — архивировать (история сохраняется). */
export async function removeOrArchive(db: FinanceDB, id: number): Promise<'deleted' | 'archived'> {
  const u = await usage(db, id)
  const cats = await db.categories.toArray()
  const ids = withChildren(cats, id)
  if (u.txs === 0 && u.recurring === 0 && u.limits === 0) {
    await db.categories.bulkDelete(ids)
    return 'deleted'
  }
  await db.categories.where('id').anyOf(ids).modify({ archived: true })
  return 'archived'
}

/**
 * Удаление категорий насовсем — атомарно: операции остаются, но становятся «Без категории»,
 * лимиты снимаются. Регулярные платежи не трогаются — их по-прежнему можно отмечать оплаченными.
 * Возвращает число затронутых операций.
 */
export async function deleteCategories(db: FinanceDB, ids: number[]): Promise<number> {
  if (!ids.length) return 0
  let moved = 0
  await db.transaction('rw', db.categories, db.txs, db.limits, async () => {
    const all = await db.categories.toArray()
    const set = new Set(ids.flatMap(id => withChildren(all, id)))
    const list = [...set]
    moved = await db.txs.where('categoryId').anyOf(list).modify({ categoryId: null })
    await db.limits.where('categoryId').anyOf(list).delete()
    await db.categories.bulkDelete(list)
  })
  return moved
}

/** Сортировка по порядку, затем по названию. */
export const byOrder = (a: Category, b: Category) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.name.localeCompare(b.name, 'ru')
