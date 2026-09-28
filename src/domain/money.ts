import type { Currency } from './types'

const SYMBOL: Record<Currency, string> = { RUB: '₽', USD: '$', EUR: '€' }

/** "1 234,5" / "1234.50" → 123450. Возвращает null для пустого или некорректного ввода. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s ]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null
  const [int, frac = ''] = s.split('.')
  return Number(int) * 100 + Number(frac.padEnd(2, '0'))
}

/** 1250000 → "12 500 ₽"; копейки показываются, только если они есть. */
export function formatMoney(minor: number, currency: Currency = 'RUB'): string {
  const neg = minor < 0
  const abs = Math.abs(Math.round(minor))
  const int = Math.floor(abs / 100)
  const frac = abs % 100
  const intStr = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const body = frac ? `${intStr},${String(frac).padStart(2, '0')}` : intStr
  return `${neg ? '−' : ''}${body} ${SYMBOL[currency]}`
}

/** Для полей ввода: 123450 → "1234,5". */
export function amountToInput(minor: number): string {
  const int = Math.floor(minor / 100)
  const frac = minor % 100
  return frac ? `${int},${String(frac).padStart(2, '0').replace(/0$/, '')}` : String(int)
}

export const toMajor = (minor: number) => minor / 100

export function todayISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const monthOf = (date: string) => date.slice(0, 7)

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const name = MONTHS[m - 1]
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`
}

export function dateLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
}
