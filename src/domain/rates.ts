import type { FinanceDB } from '../db'
import type { Currency, Rate } from './types'

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

interface CbrJson {
  Date: string
  Valute: Record<string, { Nominal: number; Value: number }>
}

function parseCbr(data: CbrJson): Rate {
  const v = (code: string) => data.Valute[code].Value / data.Valute[code].Nominal
  return { date: data.Date.slice(0, 10), USD: v('USD'), EUR: v('EUR') }
}

/** Последний опубликованный курс ЦБ. Возвращает null без сети. */
export async function refreshLatestRate(db: FinanceDB, fetcher: Fetcher = fetch): Promise<Rate | null> {
  try {
    const res = await fetcher('https://www.cbr-xml-daily.ru/daily_json.js')
    if (!res.ok) return null
    const rate = parseCbr((await res.json()) as CbrJson)
    await db.rates.put(rate)
    return rate
  } catch {
    return null
  }
}

/** Курс ЦБ на дату: из кэша, из архива ЦБ (с откатом на выходные), иначе ближайший известный. */
export async function rateFor(db: FinanceDB, date: string, fetcher: Fetcher = fetch): Promise<Rate | null> {
  const cached = await db.rates.get(date)
  if (cached) return cached

  const today = new Date().toISOString().slice(0, 10)
  if (date <= today) {
    const d = new Date(date + 'T12:00:00Z')
    for (let i = 0; i < 7; i++) {
      const [y, m, day] = d.toISOString().slice(0, 10).split('-')
      try {
        const res = await fetcher(`https://www.cbr-xml-daily.ru/archive/${y}/${m}/${day}/daily_json.js`)
        if (res.ok) {
          const rate = { ...parseCbr((await res.json()) as CbrJson), date }
          await db.rates.put(rate)
          return rate
        }
      } catch {
        break // сети нет — не перебираем дальше
      }
      d.setUTCDate(d.getUTCDate() - 1)
    }
  }

  const before = await db.rates.where('date').belowOrEqual(date).last()
  return before ?? (await db.rates.orderBy('date').last()) ?? null
}

/** Перевод суммы в рубли. Если курса нет вообще, возвращает null. */
export function convertToRub(amount: number, currency: Currency, rate: Rate | null): number | null {
  if (currency === 'RUB') return amount
  if (!rate) return null
  return Math.round(amount * rate[currency])
}

export function convertFromRub(rub: number, currency: Currency, rate: Rate | null): number | null {
  if (currency === 'RUB') return rub
  if (!rate) return null
  return Math.round(rub / rate[currency])
}
