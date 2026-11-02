import { getSettings, saveSettings, type FinanceDB } from '../db'
import { kindOf } from './categories'
import { DEFAULT_TAGS } from './types'

/** Первичное наполнение: счёт и служебная категория. Справочник категорий каждый ведёт сам. */
export async function seedIfEmpty(db: FinanceDB) {
  if ((await db.categories.count()) === 0) {
    await db.categories.add({ name: 'Разница курса при обмене', bucket: 'needs', parentId: null, archived: false, system: 'fx', kind: 'expense' })
    if ((await db.accounts.count()) === 0) {
      const accId = await db.accounts.add({ name: 'Карта', currency: 'RUB', openingBalance: 0, archived: false, order: 0, kind: 'card' })
      await saveSettings({ defaultAccountId: accId }, db)
    }
  }
  await ensureCatalog(db)
}

/**
 * Перенос данных — идемпотентно, при каждом запуске: у старых категорий проставляются тип «расход» и порядок,
 * в настройках появляется список меток. Категории не добавляются и не удаляются.
 */
export async function ensureCatalog(db: FinanceDB) {
  const cats = await db.categories.toArray()
  const untyped = cats.filter(c => c.kind == null || c.order == null)
  if (untyped.length) {
    await db.transaction('rw', db.categories, async () => {
      for (const c of untyped) await db.categories.update(c.id!, { kind: kindOf(c), order: c.order ?? c.id })
    })
  }
  const s = await getSettings(db)
  if (!s.tags) await saveSettings({ tags: DEFAULT_TAGS }, db)
}
