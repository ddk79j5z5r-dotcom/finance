import { saveSettings, type FinanceDB } from '../db'
import type { Bucket } from './types'

const DEFAULT_CATEGORIES: [string, Bucket, string[]][] = [
  ['Жильё', 'needs', ['Аренда', 'Коммуналка']],
  ['Кредиты', 'needs', []],
  ['Продукты', 'needs', []],
  ['Транспорт', 'needs', ['Метро', 'Такси', 'Бензин']],
  ['Связь и интернет', 'needs', []],
  ['Здоровье', 'needs', ['Аптека', 'Врачи']],
  ['Одежда', 'needs', []],
  ['Кафе и доставка', 'wants', []],
  ['Развлечения', 'wants', []],
  ['Подписки', 'wants', []],
  ['Подарки', 'wants', []],
  ['Путешествия', 'wants', []],
  ['Образование', 'wants', []],
  ['Прочее', 'wants', []],
]

/** Первичное наполнение: счёт и стандартные категории. Ничего не делает, если данные уже есть. */
export async function seedIfEmpty(db: FinanceDB) {
  if ((await db.categories.count()) > 0) return
  await db.transaction('rw', db.categories, db.accounts, db.settings, async () => {
    for (const [name, bucket, subs] of DEFAULT_CATEGORIES) {
      const id = await db.categories.add({ name, bucket, parentId: null, archived: false })
      for (const sub of subs) await db.categories.add({ name: sub, bucket, parentId: id!, archived: false })
    }
    await db.categories.add({ name: 'Разница курса при обмене', bucket: 'needs', parentId: null, archived: false, system: 'fx' })
    if ((await db.accounts.count()) === 0) {
      const accId = await db.accounts.add({ name: 'Карта', currency: 'RUB', openingBalance: 0, archived: false, order: 0 })
      await saveSettings({ defaultAccountId: accId }, db)
    }
  })
}
