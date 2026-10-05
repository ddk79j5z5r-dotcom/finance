import type { Bucket, Category, IncomeKind } from '../domain/types'

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  pie: 'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  chart: 'M3 3v18h18M8 17v-6M13 17V7M18 17v-4',
  wallet: 'M19 7V4H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6M16 14h.01',
  cart: 'M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.7a2 2 0 0 0 2-1.6L21 8H6M9 21h.01M18 21h.01',
  car: 'M5 17H3v-5l2-5h14l2 5v5h-2M3 12h18M9 17h6M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  bus: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM2 11h20M8 4v7M16 4v7M6 18v2M18 18v2',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
  shirt: 'M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6 5 11l2-1v10h10V10l2 1z',
  coffee: 'M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2',
  ticket: 'M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM13 5v2M13 17v2M13 11v2',
  repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  plane: 'M2 16l20-8-7 13-3-6zM12 15l10-7',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zM6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  tag: 'M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4zM7 7h.01',
  income: 'M17 7 7 17M17 17H7V7',
  expense: 'M7 17 17 7M7 7h10v10',
  transfer: 'M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
  banknote: 'M2 6h20v12H2zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M6 12h.01M18 12h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  target: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.3-4.3',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  close: 'M18 6 6 18M6 6l12 12',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  check: 'M20 6 9 17l-5-5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  percent: 'M19 5 5 19M6.5 6.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M17.5 17.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3.2 : stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

const BY_NAME: [RegExp, IconName][] = [
  [/жил|аренд|коммун|квартир/i, 'home'],
  [/кредит|долг|ипотек/i, 'card'],
  [/продукт|супермаркет/i, 'cart'],
  [/бензин|авто|машин|топлив/i, 'car'],
  [/транспорт|метро|такси|автобус/i, 'bus'],
  [/связь|интернет|телефон/i, 'phone'],
  [/здоров|апте|врач|медиц/i, 'heart'],
  [/одежд|обув/i, 'shirt'],
  [/кафе|ресторан|доставк|кофе/i, 'coffee'],
  [/развлеч|кино|отдых/i, 'ticket'],
  [/подписк/i, 'repeat'],
  [/подар/i, 'gift'],
  [/путеш|отпуск|поездк/i, 'plane'],
  [/образов|курс|книг/i, 'book'],
  [/курс|обмен/i, 'transfer'],
]

export function categoryIcon(c: Category | undefined): IconName {
  if (!c) return 'tag'
  if (c.system === 'fx') return 'transfer'
  return BY_NAME.find(([re]) => re.test(c.name))?.[1] ?? 'tag'
}

export const INCOME_ICON: Record<IncomeKind, IconName> = {
  salary: 'banknote', advance: 'banknote', bonus: 'star', interest: 'percent', gift: 'users', other: 'income',
}

/** Тонкая иконка с маленькой цветной точкой типа (нужды / желания / сбережения / доход / перевод). */
export function Badge({ icon, tone, size = 40 }: { icon: IconName; tone: Bucket | 'income' | 'transfer' | 'coupon'; size?: number }) {
  return (
    <span className="thin-ico" style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.58)} stroke={1.6} />
      <i className={`tone-dot tone-${tone}`} />
    </span>
  )
}
