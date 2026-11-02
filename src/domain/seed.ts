import { getSettings, saveSettings, type FinanceDB } from '../db'
import { addStarter, incomeCategoryFor, kindOf, starterKey } from './categories'
import { DEFAULT_TAGS } from './types'

/** Первичное наполнение: счёт и стартовый справочник доходов и расходов. Ничего не делает, если данные уже есть. */
export async function seedIfEmpty(db: FinanceDB) {
  if ((await db.categories.count()) === 0) {
    await addStarter(db, 'expense')
    await db.categories.add({ name: 'Разница курса при обмене', bucket: 'needs', parentId: null, archived: false, system: 'fx', kind: 'expense' })
    await saveSettings({ starterDismissed: true }, db)
    if ((await db.accounts.count()) === 0) {
      const accId = await db.accounts.add({ name: 'Карта', currency: 'RUB', openingBalance: 0, archived: false, order: 0, kind: 'card' })
      await saveSettings({ defaultAccountId: accId }, db)
    }
  }
  await ensureCatalog(db)
}

/**
 * Перенос данных на новый справочник — идемпотентно, при каждом запуске:
 * у старых категорий проставляется тип «расход» и порядок; добавляются категории доходов;
 * доходы без категории получают её по своему виду (зарплата → «Работа · Зарплата» и т.д.);
 * в настройках появляется список меток. Пользовательские категории не заменяются и не удаляются.
 */
export async function ensureCatalog(db: FinanceDB) {
  const cats = await db.categories.toArray()
  const untyped = cats.filter(c => c.kind == null || c.order == null)
  if (untyped.length) {
    await db.transaction('rw', db.categories, async () => {
      for (const c of untyped) await db.categories.update(c.id!, { kind: kindOf(c), order: c.order ?? c.id })
    })
  }
  if (!cats.some(c => c.key?.startsWith('income/'))) {
    // «От родителей» — так назывался вид дохода раньше; сохраняем это название в справочнике.
    const hadGifts = (await db.txs.where('type').equals('income').filter(t => t.incomeKind === 'gift').count()) > 0
    await addStarter(db, 'income')
    if (hadGifts) {
      const all = await db.categories.toArray()
      const other = all.find(c => c.key === starterKey('income', 'Прочие доходы'))
      if (other && !all.some(c => c.key === starterKey('income', 'Прочие доходы', 'От родителей'))) {
        await db.categories.add({ name: 'От родителей', parentId: other.id!, bucket: 'needs', archived: false, kind: 'income', order: -1, key: starterKey('income', 'Прочие доходы', 'От родителей') })
      }
    }
  }
  const orphans = await db.txs.where('type').equals('income').filter(t => t.categoryId == null).toArray()
  if (orphans.length) {
    const all = await db.categories.toArray()
    await db.transaction('rw', db.txs, async () => {
      for (const t of orphans) {
        const c = incomeCategoryFor(all, t)
        if (c) await db.txs.update(t.id!, { categoryId: c.id })
      }
    })
  }
  const s = await getSettings(db)
  if (!s.tags) await saveSettings({ tags: DEFAULT_TAGS }, db)
}
