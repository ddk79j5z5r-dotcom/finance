import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayTitle, goalPct, monthYear, shortDate, txTime } from './format'
import type { Tx } from './types'

// «Сейчас» — суббота, 31 октября 2026, 12:00 по местному времени
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 31, 12, 0))
})
afterEach(() => vi.useRealTimers())

describe('shortDate', () => {
  it('день и сокращённый месяц', () => {
    expect(shortDate('2026-10-05')).toBe('5 окт.')
    expect(shortDate('2026-12-31')).toBe('31 дек.')
  })
})

describe('dayTitle', () => {
  it('сегодня', () => {
    expect(dayTitle('2026-10-31')).toBe('Сегодня, 31 октября')
  })
  it('вчера', () => {
    expect(dayTitle('2026-10-30')).toBe('Вчера, 30 октября')
  })
  it('вчера через границу месяца', () => {
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0))
    expect(dayTitle('2026-10-31')).toBe('Вчера, 31 октября')
  })
  it('другой день этого года — день недели с заглавной буквы, без года', () => {
    expect(dayTitle('2026-10-29')).toBe('Чт, 29 октября') // четверг
    expect(dayTitle('2026-01-01')).toBe('Чт, 1 января')
  })
  it('день из другого года показывает год', () => {
    expect(dayTitle('2025-12-31')).toBe('Ср, 31 декабря 2025 г.') // среда
  })
  it('«сегодня» из прошлого года — не «Сегодня»', () => {
    expect(dayTitle('2025-10-31')).not.toContain('Сегодня')
  })
})

describe('txTime', () => {
  const base: Tx = { date: '2026-10-31', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: '', createdAt: 0 }
  it('возвращает время, если запись сделана в день операции', () => {
    expect(txTime({ ...base, createdAt: new Date(2026, 9, 31, 14, 5).getTime() })).toBe('14:05')
  })
  it('возвращает null, если операция записана задним числом', () => {
    expect(txTime({ ...base, date: '2026-10-20', createdAt: new Date(2026, 9, 31, 14, 5).getTime() })).toBeNull()
  })
  it('возвращает null, если дата операции в будущем относительно записи', () => {
    expect(txTime({ ...base, date: '2026-11-05', createdAt: new Date(2026, 9, 31, 14, 5).getTime() })).toBeNull()
  })
  it('возвращает null для импортированных операций (createdAt = 0)', () => {
    expect(txTime(base)).toBeNull()
  })
})

describe('goalPct', () => {
  it('нулевая или отрицательная цель — прочерк', () => {
    expect(goalPct(500, 0)).toEqual({ pct: 0, label: '—', width: 0 })
    expect(goalPct(500, -10)).toEqual({ pct: 0, label: '—', width: 0 })
  })
  it('ничего не накоплено — 0% и пустая шкала', () => {
    expect(goalPct(0, 1000)).toEqual({ pct: 0, label: '0%', width: 0 })
  })
  it('обычный прогресс округляется вниз', () => {
    expect(goalPct(500, 1000)).toEqual({ pct: 50, label: '50%', width: 50 })
    expect(goalPct(999, 1000)).toMatchObject({ pct: 99, label: '99%' })
  })
  it('крошечная сумма даёт «<1%», а не 0%', () => {
    expect(goalPct(1, 1000).label).toBe('<1%')
  })
  it('шкала при накоплении не уже 1,5', () => {
    expect(goalPct(1, 1000).width).toBe(1.5)
    expect(goalPct(12, 1000).width).toBe(1.5) // 1,2% < 1,5
    expect(goalPct(20, 1000).width).toBe(2)
  })
  it('ровно 1% — подпись «1%»', () => {
    expect(goalPct(10, 1000).label).toBe('1%')
  })
  it('достигнутая цель — 100%', () => {
    expect(goalPct(1000, 1000)).toMatchObject({ pct: 100, label: '100%' })
  })
  it('перевыполнение ограничено потолком 100%', () => {
    const r = goalPct(2500, 1000)
    expect(r.pct).toBe(100)
    expect(r.label).toBe('100%')
  })
  it('ширина шкалы не превышает 100 при перевыполнении', () => {
    expect(goalPct(2500, 1000).width).toBeLessThanOrEqual(100)
  })
})

describe('monthYear', () => {
  it('месяц в родительном падеже и год', () => {
    expect(monthYear('2030-12')).toBe('декабря 2030 г.')
    expect(monthYear('2027-01')).toBe('января 2027 г.')
    expect(monthYear('2026-05')).toBe('мая 2026 г.')
  })
})
