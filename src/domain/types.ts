export type Currency = 'RUB' | 'USD' | 'EUR'
export const CURRENCIES: Currency[] = ['RUB', 'USD', 'EUR']

/** Куда относится категория в правиле 50/30/20. */
export type Bucket = 'needs' | 'wants' | 'savings'
export const BUCKETS: Bucket[] = ['needs', 'wants', 'savings']

/** Регулярный доход (salary, advance, bonus) идёт в базу правила; нерегулярный (gift, other) — нет. */
export type IncomeKind = 'salary' | 'advance' | 'bonus' | 'interest' | 'gift' | 'other'
export const REGULAR_INCOME: IncomeKind[] = ['salary', 'advance', 'bonus']

export type TxType = 'expense' | 'income' | 'transfer'

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
  /** Учитывать в 50/30/20 как сбережения. Не задано — да, если на счёте есть цель. */
  savings?: boolean
  /** С купонов не удерживается налог (например, ИИС). */
  taxFree?: boolean
}

export const ACCOUNT_COLORS = ['yellow', 'green', 'blue', 'sky', 'orange', 'pink', 'violet', 'gray'] as const
export type AccountColor = (typeof ACCOUNT_COLORS)[number]

export type AccountKind = 'card' | 'savings'

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
}

/** Лимит конверта (категории верхнего уровня) начиная с месяца; действует до следующей записи. */
export interface Limit {
  id?: number
  categoryId: number
  month: string // YYYY-MM
  amount: number // ₽
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
  expectedAdvance: number
  defaultAccountId: number | null
  lastExportAt: number | null
  categoriesReviewed?: boolean
  setupDismissed?: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  rule: { needs: 50, wants: 30, savings: 20 },
  salaryDay: 13,
  advanceDay: 28,
  expectedSalary: 0,
  expectedAdvance: 0,
  defaultAccountId: null,
  lastExportAt: null,
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
