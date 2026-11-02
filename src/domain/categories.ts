import type { FinanceDB } from '../db'
import type { Category, CategoryKind, IncomeKind, Tx } from './types'

// ---------- Справочник категорий ----------

/** Тип категории: у старых записей не задан — это расходы. */
export const kindOf = (c: Pick<Category, 'kind'>): CategoryKind => c.kind ?? 'expense'

const norm = (s: string) => s.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ')

type Starter = [name: string, icon: string, color: string, subs: string[]]

/** Стартовый справочник. Ключ записи — «тип/родитель/подкатегория», поэтому повторная загрузка не создаёт дубли. */
export const STARTER: Record<CategoryKind, Starter[]> = {
  income: [
    ['Работа', 'briefcase', '#2fb36a', ['Зарплата', 'Аванс', 'Премия', 'Надбавки и доплаты', 'Сверхурочная работа', 'Отпускные', 'Больничные', 'Компенсация жилья', 'Другие компенсации', 'Подработка', 'Фриланс']],
    ['Бизнес', 'bag', '#20b8a8', ['Продажи', 'Оказание услуг', 'Доход от проектов', 'Прочий доход от бизнеса']],
    ['Инвестиционный доход', 'percent', '#9b6bff', ['Купоны', 'Дивиденды', 'Проценты по вкладам', 'Проценты на остаток', 'Прочий инвестиционный доход']],
    ['Имущество', 'home', '#3d8bfd', ['Аренда недвижимости', 'Аренда другого имущества', 'Продажа личных вещей']],
    ['Прочие доходы', 'gift', '#f0a81c', ['Подарки', 'Кешбэк', 'Налоговый вычет', 'Социальные выплаты', 'Страховые выплаты', 'Прочие доходы']],
  ],
  expense: [
    ['Жильё', 'home', '#3d8bfd', ['Аренда', 'Электроэнергия', 'Вода', 'Отопление', 'Газ', 'Содержание дома', 'Капремонт', 'Вывоз мусора', 'Домашний интернет', 'Телевидение', 'Ремонт жилья', 'Мебель', 'Бытовая техника', 'Посуда', 'Текстиль', 'Декор и освещение', 'Бытовая химия', 'Хозяйственные товары', 'Уборка', 'Прочее']],
    ['Продукты', 'cart', '#f2588a', ['Продукты без детализации', 'Мясо и птица', 'Рыба и морепродукты', 'Овощи и фрукты', 'Молочные продукты', 'Хлеб и выпечка', 'Крупы и макароны', 'Напитки', 'Сладости и снеки', 'Доставка продуктов', 'Алкоголь', 'Прочее']],
    ['Питание вне дома', 'utensils', '#f26b3a', ['Обеды на работе', 'Кафе и рестораны', 'Фастфуд', 'Кофе', 'Доставка еды', 'Прочее']],
    ['Автомобиль', 'car', '#2fa4f0', ['Топливо', 'Мойка и химчистка', 'Парковка', 'Гараж', 'Платные дороги', 'Штрафы', 'Транспортный налог', 'ОСАГО', 'КАСКО', 'Техосмотр', 'Плановое ТО', 'Масла и жидкости', 'Фильтры', 'Двигатель', 'Коробка передач', 'Подвеска', 'Тормоза', 'Рулевое управление', 'Электрика и диагностика', 'Кузовной ремонт', 'Покраска', 'Шины', 'Диски', 'Шиномонтаж', 'Аккумулятор', 'Другие запчасти', 'Инструменты', 'Аксессуары', 'Салон и перетяжка', 'Шумоизоляция', 'Тюнинг', 'Эвакуатор', 'Прочее']],
    ['Транспорт', 'bus', '#f5a623', ['Общественный транспорт', 'Такси', 'Каршеринг', 'Аренда транспорта', 'Электрички', 'Прочее']],
    ['Здоровье', 'heart', '#f0544f', ['Врачи', 'Анализы', 'Обследования', 'Лекарства', 'Стоматология', 'Операции и лечение', 'Реабилитация', 'Лечебный массаж', 'Психолог', 'Очки и линзы', 'Медицинская страховка', 'Медицинские товары', 'Витамины и добавки', 'Прочее']],
    ['Спорт', 'sport', '#2fb36a', ['Спортзал', 'Тренер', 'Групповые занятия', 'Спортивное питание', 'Спортивная одежда', 'Инвентарь', 'Бассейн', 'Секции', 'Прочее']],
    ['Одежда и обувь', 'shirt', '#b065ea', ['Верхняя одежда', 'Повседневная одежда', 'Рабочая одежда', 'Обувь', 'Нижнее бельё и носки', 'Аксессуары', 'Сумки и рюкзаки', 'Часы и украшения', 'Ремонт одежды и обуви', 'Химчистка', 'Прочее']],
    ['Уход за собой', 'beauty', '#e46fd0', ['Парикмахерская и барбершоп', 'Волосы', 'Борода', 'Кожа', 'Гигиена', 'Парфюмерия', 'Бритвы и принадлежности', 'Косметические процедуры', 'Прочее']],
    ['Связь и подписки', 'wifi', '#20b8a8', ['Мобильная связь', 'Облачное хранилище', 'Музыка', 'Кино и сериалы', 'Игровые подписки', 'Программы и приложения', 'VPN', 'ИИ-сервисы', 'Прочие подписки']],
    ['Техника', 'phone', '#5b7cf5', ['Телефон', 'Компьютер', 'Планшет', 'Телевизор', 'Наушники и аудио', 'Умные устройства', 'Аксессуары', 'Ремонт техники', 'Прочее']],
    ['Развлечения и хобби', 'game', '#8a5cf6', ['Игры', 'Приставки и аксессуары', 'Кино', 'Театр', 'Концерты', 'Книги', 'Творчество', 'Выставки и мероприятия', 'Настольные игры', 'Отдых с друзьями', 'Прочее']],
    ['Путешествия', 'plane', '#2fb3e6', ['Авиабилеты', 'Поезда', 'Междугородние автобусы', 'Проживание', 'Питание в поездке', 'Транспорт в поездке', 'Экскурсии', 'Туристическая страховка', 'Визы и документы', 'Багаж', 'Сувениры', 'Прочее']],
    ['Образование', 'book', '#8a72f2', ['Университет', 'Курсы', 'Учебники и материалы', 'Профессиональное обучение', 'Иностранные языки', 'Конференции и семинары', 'Программы для обучения', 'Прочее']],
    ['Семья и подарки', 'gift', '#f2647f', ['Помощь родителям', 'Помощь родственникам', 'Подарки семье', 'Подарки друзьям', 'Цветы', 'Праздники', 'Прочее']],
    ['Дети', 'baby', '#f58fb0', ['Питание', 'Одежда и обувь', 'Детский сад', 'Школа', 'Кружки и секции', 'Игрушки', 'Здоровье', 'Карманные деньги', 'Прочее']],
    ['Животные', 'paw', '#c4864a', ['Корм', 'Ветеринар', 'Лекарства', 'Игрушки и аксессуары', 'Груминг', 'Передержка', 'Прочее']],
    ['Работа', 'briefcase', '#8d6e52', ['Канцелярия', 'Рабочее оборудование', 'Рабочая одежда', 'Программы', 'Профессиональные расходы', 'Деловые встречи', 'Прочее']],
    ['Банковские расходы', 'card', '#7a6cf0', ['Обслуживание счетов и карт', 'Комиссии за переводы', 'Комиссии за наличные', 'Проценты по кредитам', 'Штрафы и пени', 'Брокерские комиссии', 'Прочее']],
    ['Налоги и документы', 'tag', '#7d8794', ['Налог на доход', 'Налог на имущество', 'Другие налоги', 'Госпошлины', 'Юридические услуги', 'Нотариус', 'Оформление документов', 'Прочее']],
    ['Благотворительность', 'smile', '#f0a81c', ['Благотворительные организации', 'Адресная помощь', 'Пожертвования', 'Прочее']],
    ['Вредные привычки', 'zap', '#7d8794', ['Табак', 'Электронные сигареты и расходники', 'Прочее']],
    ['Прочие расходы', 'tag', '#8a93a0', ['Непредвиденные расходы', 'Потери', 'Прочее']],
  ],
}

export const starterKey = (kind: CategoryKind, root: string, sub?: string) => [kind, root, sub].filter(Boolean).join('/')

/** Сколько записей стартового набора ещё нет в справочнике (по ключу или совпадающему названию у того же родителя). */
export function missingStarter(categories: Category[], kind: CategoryKind, roots?: string[]): { roots: number; subs: number } {
  let r = 0, s = 0
  for (const [name, , , subs] of STARTER[kind]) {
    if (roots && !roots.includes(name)) continue
    const root = findStarter(categories, kind, name, null)
    if (!root) { r++; s += subs.length; continue }
    for (const sub of subs) if (!findStarter(categories, kind, sub, root.id!, name)) s++
  }
  return { roots: r, subs: s }
}

function findStarter(categories: Category[], kind: CategoryKind, name: string, parentId: number | null, rootName?: string): Category | undefined {
  const key = parentId == null ? starterKey(kind, name) : starterKey(kind, rootName!, name)
  return categories.find(c => c.key === key)
    ?? categories.find(c => !c.system && kindOf(c) === kind && c.parentId === parentId && norm(c.name) === norm(name))
}

/**
 * Добавляет стартовые категории. Идемпотентно: найденную по ключу или по названию у того же родителя
 * запись не дублирует, а только помечает ключом; архивные не трогает. Возвращает число добавленных записей.
 */
export async function addStarter(db: FinanceDB, kind: CategoryKind, roots?: string[]): Promise<number> {
  let added = 0
  await db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray()
    let order = Math.max(-1, ...all.filter(c => c.parentId == null && kindOf(c) === kind).map(c => c.order ?? 0))
    for (const [name, icon, color, subs] of STARTER[kind]) {
      if (roots && !roots.includes(name)) continue
      let root = findStarter(all, kind, name, null)
      if (!root) {
        root = { name, parentId: null, bucket: 'needs', archived: false, kind, icon, color, order: ++order, key: starterKey(kind, name) }
        root.id = await db.categories.add(root)
        all.push(root)
        added++
      } else if (!root.key) {
        await db.categories.update(root.id!, { key: starterKey(kind, name) })
        root.key = starterKey(kind, name)
      }
      let subOrder = Math.max(-1, ...all.filter(c => c.parentId === root!.id).map(c => c.order ?? 0))
      for (const sub of subs) {
        const found = findStarter(all, kind, sub, root.id!, name)
        if (found) {
          if (!found.key) await db.categories.update(found.id!, { key: starterKey(kind, name, sub) })
          continue
        }
        const c: Category = { name: sub, parentId: root.id!, bucket: 'needs', archived: false, kind, order: ++subOrder, key: starterKey(kind, name, sub) }
        c.id = await db.categories.add(c)
        all.push(c)
        added++
      }
    }
  })
  return added
}

// ---------- Доходы: вид дохода для расчётов по выплатам ----------

/** Вид дохода по категории: зарплата и аванс нужны для «Доступно до дохода» и календаря выплат. */
export function incomeKindFor(categories: Category[], id: number | null | undefined): IncomeKind {
  const c = categories.find(x => x.id === id)
  const key = c?.key ?? ''
  if (key === starterKey('income', 'Работа', 'Зарплата')) return 'salary'
  if (key === starterKey('income', 'Работа', 'Аванс')) return 'advance'
  if (key === starterKey('income', 'Работа', 'Премия')) return 'bonus'
  if (key.startsWith('income/Инвестиционный доход')) return 'interest'
  if (key === starterKey('income', 'Прочие доходы', 'Подарки') || key === starterKey('income', 'Прочие доходы', 'От родителей')) return 'gift'
  return 'other'
}

/** Категория дохода для старых операций без категории — по их виду дохода. */
export function incomeCategoryFor(categories: Category[], t: Pick<Tx, 'incomeKind' | 'secid'>): Category | undefined {
  const k = (root: string, sub: string) => categories.find(c => c.key === starterKey('income', root, sub))
  switch (t.incomeKind) {
    case 'salary': return k('Работа', 'Зарплата')
    case 'advance': return k('Работа', 'Аванс')
    case 'bonus': return k('Работа', 'Премия')
    case 'interest': return t.secid ? k('Инвестиционный доход', 'Купоны') : k('Инвестиционный доход', 'Проценты на остаток')
    case 'gift': return k('Прочие доходы', 'От родителей') ?? k('Прочие доходы', 'Подарки')
    default: return k('Прочие доходы', 'Прочие доходы')
  }
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

/** Сортировка по порядку, затем по названию. */
export const byOrder = (a: Category, b: Category) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.name.localeCompare(b.name, 'ru')
