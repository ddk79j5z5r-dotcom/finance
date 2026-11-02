export type Currency = 'RUB' | 'USD' | 'EUR'
export const CURRENCIES: Currency[] = ['RUB', 'USD', 'EUR']

/** Куда относится категория в правиле 50/30/20. */
export type Bucket = 'needs' | 'wants' | 'savings'
export const BUCKETS: Bucket[] = ['needs', 'wants', 'savings']

/** Регулярный доход (salary, advance, bonus) идёт в базу правила; нерегулярный (gift, other) — нет. */
export type IncomeKind = 'salary' | 'advance' | 'bonus' | 'interest' | 'gift' | 'other'
export const REGULAR_INCOME: IncomeKind[] = ['salary', 'advance', 'bonus']

/**
 * Тип операции — что происходит с деньгами (отдельно от категории):
 * expense — потребительский расход; income — доход; transfer — перемещение между своими счетами
 * (в том числе получение и погашение кредита, выдача и возврат долга, пополнение вклада и брокерского счёта);
 * refund — возврат покупки (уменьшает расходы своей категории); adjust — корректировка остатка (не доход и не расход).
 */
export type TxType = 'expense' | 'income' | 'transfer' | 'refund' | 'adjust'

/** Все суммы — целые числа в минимальных единицах (копейки/центы). */
export interface Account {
  id?: number
  name: string
  currency: Currency
  openingBalance: number
  archived: boolean
  order: number
  /** Карта (с неё платим) или копилка (там лежат отложенные деньги). Не задано — угадывается по названию. */
  kind?: AccountKind
  /** Цвет из ACCOUNT_COLORS; не задан — подбирается по названию. */
  color?: AccountColor
  /** Показывать под общим балансом на главной. */
  showOnHome?: boolean
  /** Роль в 50/30/20: деньги, переведённые на счёт, — нужды, желания или сбережения. Карта — всегда нужды. */
  role?: Bucket
  /** Устаревший флажок «Сбережения» (до появления роли) — учитывается, если роль не задана. */
  savings?: boolean
  /** С купонов не удерживается налог (например, ИИС). */
  taxFree?: boolean
  /** Учитывать в общем балансе и в «Доступно до дохода». Не задано — учитывается. */
  inTotal?: boolean
  /** Кредитный лимит (для kind = 'credit'): доступно = лимит − задолженность. */
  creditLimit?: number | null
}

export const ACCOUNT_COLORS = ['yellow', 'green', 'blue', 'sky', 'orange', 'pink', 'violet', 'gray'] as const
export type AccountColor = (typeof ACCOUNT_COLORS)[number]

/**
 * card — карта или наличные; savings — копилка, вклад; broker — брокерский счёт;
 * credit — мой долг: кредит, кредитная карта, личный заём (баланс отрицательный — это задолженность);
 * debt — мне должны: выданный в долг (актив).
 */
export type AccountKind = 'card' | 'savings' | 'broker' | 'credit' | 'debt'

export type CategoryKind = 'expense' | 'income'

export interface Category {
  id?: number
  name: string
  parentId: number | null
  bucket: Bucket
  archived: boolean
  /** Служебная категория для разницы курса при обмене валют. */
  system?: 'fx'
  /** Счёт, который подставляется при выборе этой категории. */
  accountId?: number | null
  /** Иконка, выбранная вручную (иначе подбирается по названию). */
  icon?: string
  /** Расход или доход. Не задано — расход (так хранились категории до появления доходных). */
  kind?: CategoryKind
  /** Цвет значка (#rrggbb); не задан — по иконке. */
  color?: string
  /** Порядок внутри родителя (меньше — выше). */
  order?: number
  favorite?: boolean
  /** Ключ стартового справочника: по нему повторная загрузка не создаёт дубли. */
  key?: string
}

export interface Tx {
  id?: number
  date: string // YYYY-MM-DD
  type: TxType
  accountId: number
  amount: number // в валюте счёта, > 0
  rub: number // эквивалент в рублях по курсу ЦБ на дату
  categoryId?: number | null
  incomeKind?: IncomeKind
  // перевод / обмен
  toAccountId?: number
  toAmount?: number
  toRub?: number
  comment: string
  createdAt: number
  /** Купон по облигации: бумага и ключ события (чтобы не предлагать его снова). */
  secid?: string
  eventKey?: string
  /** Метки — независимы от категорий и не меняют учёт сумм. */
  tags?: string[]
  /** Для возврата: исходный расход. */
  refundOf?: number
  /** Общий идентификатор связанных записей: части разделённой покупки, платёж по кредиту + проценты, перевод + комиссия. */
  group?: string
}

/** Лимит конверта (категории верхнего уровня) начиная с месяца; действует до следующей записи. */
export interface Limit {
  id?: number
  categoryId: number
  month: string // YYYY-MM
  amount: number // ₽
  /** Лимит задан явно, даже если он 0 ₽. Запись с amount 0 без этого флажка — «лимит снят» (так было и раньше). */
  strict?: boolean
}

export interface Recurring {
  id?: number
  /** payment — платёж в день месяца; topup — ежемесячное пополнение копилки (без даты). */
  kind?: 'payment' | 'topup'
  name: string
  amount: number
  currency: Currency
  day: number
  categoryId: number
  /** Из какой выплаты резервировать; both — пополам из зарплаты и аванса. */
  fundFrom: 'salary' | 'advance' | 'both'
  /** Счёт-копилка, где копятся деньги на этот платёж (например, «Квартира»). */
  reserveAccountId?: number | null
  active: boolean
  /** Месяцы YYYY-MM, в которых платёж отмечен оплаченным вручную — без записи расхода. */
  paidMonths?: string[]
}

export interface Goal {
  id?: number
  name: string
  target: number // в валюте счёта
  accountId: number
  priority: number
  /** Необязательный срок YYYY-MM: к концу этого месяца цель должна быть собрана. */
  deadline?: string | null
}

/** Как распределено конкретное поступление (₽). */
export interface Allocation {
  id?: number
  txId: number
  month: string
  needs: number
  wants: number
  savings: number
}

/** Рублей за единицу валюты. */
export interface Rate {
  date: string
  USD: number
  EUR: number
}

export interface Settings {
  rule: Record<Bucket, number> // проценты
  salaryDay: number
  advanceDay: number
  expectedSalary: number // ₽, 0 — не задано
  /** Расчёт выплат по окладу (как калькулятор ipipip.ru/kz): если задан, суммы аванса и зарплаты считаются сами. Копейки, ставка — проценты. */
  pay?: {
    gross: number
    /** Надбавки и доплаты — постоянная часть начислений, делится между авансом и зарплатой. */
    bonus: number
    rate: number
    deduction: number
    /** Премия каждый месяц: процент от оклада или сумма (копейки) до НДФЛ; day 0 — вместе с зарплатой. */
    premium?: { mode: 'percent' | 'amount'; value: number; day: number }
    /** Другие ежемесячные выплаты (компенсации и т. п.): сумма до НДФЛ, если taxed, иначе на руки. */
    extras?: { name: string; amount: number; day: number; taxed: boolean }[]
  }
  expectedAdvance: number
  defaultAccountId: number | null
  lastExportAt: number | null
  categoriesReviewed?: boolean
  setupDismissed?: boolean
  /** Когда последний раз закрыли напоминание о бэкапе (показывается не чаще раза в неделю). */
  backupNudgeAt?: number | null
  /** Список меток для операций. */
  tags?: string[]
  /** Предложение добавить стартовый справочник расходов уже показано (для пользователей со своим справочником). */
  starterDismissed?: boolean
}

export const DEFAULT_TAGS = ['Aristo', 'Проект Aristo', 'Работа', 'Отпуск', 'Обязательное', 'Необязательное']

export const DEFAULT_SETTINGS: Settings = {
  rule: { needs: 50, wants: 30, savings: 20 },
  salaryDay: 13,
  advanceDay: 28,
  expectedSalary: 0,
  expectedAdvance: 0,
  defaultAccountId: null,
  lastExportAt: null,
  tags: DEFAULT_TAGS,
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  needs: 'Нужды',
  wants: 'Желания',
  savings: 'Сбережения',
}

export const INCOME_LABEL: Record<IncomeKind, string> = {
  salary: 'Зарплата',
  advance: 'Аванс',
  bonus: 'Премия',
  interest: 'Проценты',
  gift: 'От родителей',
  other: 'Прочие поступления',
}
