import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FinanceDB } from '../db'
import { convertFromRub, convertToRub, rateFor, refreshLatestRate } from './rates'
import type { Rate } from './types'

let n = 0
const freshDb = () => new FinanceDB(`rates-test-${n++}`)

const cbr = (date: string, usd: number, eur: number, nominal = 1) => ({
  Date: `${date}T11:30:00+03:00`,
  Valute: { USD: { Nominal: nominal, Value: usd * nominal }, EUR: { Nominal: nominal, Value: eur * nominal } },
})
const okJson = (body: unknown) => ({ ok: true, json: async () => body })
const notFound = { ok: false, json: async () => ({}) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }) // таймеры нужны fake-indexeddb, подменяем только дату
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z')) // четверг
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('refreshLatestRate', () => {
  it('сохраняет последний курс и возвращает его', async () => {
    const db = freshDb()
    const fetcher = vi.fn(async () => okJson(cbr('2026-10-15', 80.5, 90.25)))
    const rate = await refreshLatestRate(db, fetcher)
    expect(rate).toEqual({ date: '2026-10-15', USD: 80.5, EUR: 90.25 })
    expect(await db.rates.get('2026-10-15')).toEqual(rate)
    expect(fetcher).toHaveBeenCalledWith('https://www.cbr-xml-daily.ru/daily_json.js')
  })
  it('делит курс на номинал', async () => {
    const rate = await refreshLatestRate(freshDb(), async () => okJson(cbr('2026-10-15', 80, 90, 10)))
    expect(rate).toMatchObject({ USD: 80, EUR: 90 })
  })
  it('без сети возвращает null и ничего не пишет', async () => {
    const db = freshDb()
    expect(await refreshLatestRate(db, async () => { throw new TypeError('offline') })).toBeNull()
    expect(await db.rates.count()).toBe(0)
  })
  it('на ответ с ошибкой возвращает null', async () => {
    const db = freshDb()
    expect(await refreshLatestRate(db, async () => notFound)).toBeNull()
    expect(await db.rates.count()).toBe(0)
  })
  it('на битый JSON возвращает null', async () => {
    expect(await refreshLatestRate(freshDb(), async () => okJson({ foo: 1 }))).toBeNull()
  })
  it('по умолчанию использует глобальный fetch', async () => {
    const stub = vi.fn(async () => okJson(cbr('2026-10-15', 81, 91)))
    vi.stubGlobal('fetch', stub)
    expect(await refreshLatestRate(freshDb())).toMatchObject({ USD: 81 })
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('rateFor', () => {
  it('отдаёт курс из кэша без обращения к сети', async () => {
    const db = freshDb()
    await db.rates.put({ date: '2026-10-10', USD: 80, EUR: 90 })
    const fetcher = vi.fn()
    expect(await rateFor(db, '2026-10-10', fetcher)).toEqual({ date: '2026-10-10', USD: 80, EUR: 90 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('качает курс из архива ЦБ и кэширует под запрошенной датой', async () => {
    const db = freshDb()
    const fetcher = vi.fn(async () => okJson(cbr('2026-10-09', 79, 89)))
    const rate = await rateFor(db, '2026-10-10', fetcher)
    expect(rate).toEqual({ date: '2026-10-10', USD: 79, EUR: 89 })
    expect(fetcher).toHaveBeenCalledWith('https://www.cbr-xml-daily.ru/archive/2026/10/10/daily_json.js')
    expect(await db.rates.get('2026-10-10')).toEqual(rate)
  })
  it('второй вызов на ту же дату берёт кэш', async () => {
    const db = freshDb()
    const fetcher = vi.fn(async () => okJson(cbr('2026-10-09', 79, 89)))
    await rateFor(db, '2026-10-10', fetcher)
    await rateFor(db, '2026-10-10', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('на выходной откатывается назад до дня с публикацией', async () => {
    const db = freshDb()
    // 2026-10-11 — воскресенье, 10 — суббота, 9 — пятница
    const urls: string[] = []
    const fetcher = async (url: string) => {
      urls.push(url)
      return url.includes('/2026/10/09/') ? okJson(cbr('2026-10-09', 77, 87)) : notFound
    }
    const rate = await rateFor(db, '2026-10-11', fetcher)
    expect(rate).toEqual({ date: '2026-10-11', USD: 77, EUR: 87 })
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain('/2026/10/11/')
    expect(urls[2]).toContain('/2026/10/09/')
  })
  it('без сети не перебирает дни и откатывается на ближайший ранний кэш', async () => {
    const db = freshDb()
    await db.rates.bulkPut([
      { date: '2026-10-01', USD: 70, EUR: 80 },
      { date: '2026-10-05', USD: 75, EUR: 85 },
      { date: '2026-10-14', USD: 99, EUR: 109 },
    ])
    const fetcher = vi.fn(async () => { throw new TypeError('offline') })
    const rate = await rateFor(db, '2026-10-08', fetcher)
    expect(rate).toEqual({ date: '2026-10-05', USD: 75, EUR: 85 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('пробует не больше 7 дней, если архив ничего не отдаёт', async () => {
    const db = freshDb()
    const fetcher = vi.fn(async () => notFound)
    expect(await rateFor(db, '2026-10-10', fetcher)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(7)
  })
  it('для будущей даты сеть не трогает и берёт последний известный курс', async () => {
    const db = freshDb()
    await db.rates.put({ date: '2026-10-14', USD: 99, EUR: 109 })
    const fetcher = vi.fn()
    expect(await rateFor(db, '2026-12-01', fetcher)).toEqual({ date: '2026-10-14', USD: 99, EUR: 109 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('«сегодня» определяется по системному времени', async () => {
    const db = freshDb()
    const fetcher = vi.fn(async () => notFound)
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    await rateFor(db, '2026-10-16', fetcher) // завтра — в сеть не ходим
    expect(fetcher).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    await rateFor(db, '2026-10-16', fetcher) // теперь это сегодня
    expect(fetcher).toHaveBeenCalled()
  })
  it('офлайн и без кэша возвращает null', async () => {
    const fetcher = async () => { throw new TypeError('offline') }
    expect(await rateFor(freshDb(), '2026-10-10', fetcher)).toBeNull()
  })
  it('дата старше всех известных курсов при отсутствии сети отдаёт самый свежий кэш', async () => {
    const db = freshDb()
    await db.rates.put({ date: '2026-10-14', USD: 99, EUR: 109 })
    const rate = await rateFor(db, '2020-01-01', async () => { throw new TypeError('offline') })
    expect(rate?.date).toBe('2026-10-14')
  })
})

describe('convertToRub / convertFromRub', () => {
  const rate: Rate = { date: '2026-10-15', USD: 80.5, EUR: 90 }
  it('рубли не конвертируются и не требуют курса', () => {
    expect(convertToRub(12345, 'RUB', null)).toBe(12345)
    expect(convertFromRub(12345, 'RUB', null)).toBe(12345)
  })
  it('без курса валюта не конвертируется', () => {
    expect(convertToRub(10000, 'USD', null)).toBeNull()
    expect(convertFromRub(10000, 'EUR', null)).toBeNull()
  })
  it('100 $ по 80,5 = 8050 ₽ (в копейках)', () => {
    expect(convertToRub(10000, 'USD', rate)).toBe(805000)
  })
  it('100 € по 90 = 9000 ₽', () => {
    expect(convertToRub(10000, 'EUR', rate)).toBe(900000)
  })
  it('округляет до копейки', () => {
    // 0,01 $ (1 коп.) × 80,5 = 80,5 коп. → 81
    expect(convertToRub(1, 'USD', rate)).toBe(81)
  })
  it('обратная конвертация: 9000 ₽ при курсе 90 = 100 €', () => {
    expect(convertFromRub(900000, 'EUR', rate)).toBe(10000)
  })
  it('нулевая сумма остаётся нулём', () => {
    expect(convertToRub(0, 'USD', rate)).toBe(0)
  })
})
