import type { Tx } from './types'

/** Данные бумаги с Московской биржи (кэш на устройстве). Деньги — в копейках за одну облигацию. */
export interface Bond {
  secid: string
  isin: string
  shortName: string
  boardId: string
  face: number // текущий номинал
  price: number | null // цена, % от номинала
  accrued: number // НКД на одну бумагу
  matDate: string | null
  coupons: { date: string; recordDate: string; value: number | null }[] // value null — ещё не объявлен (плавающий)
  redemptions: { date: string; value: number; kind: 'amortization' | 'maturity' | 'offer' }[]
  updatedAt: number
}

/** Сделка по облигации. amount — сколько денег ушло (buy) или пришло (sell, redeem) на счёт, с НКД и комиссией. */
export interface Trade {
  id?: number
  accountId: number
  secid: string
  date: string
  type: 'buy' | 'sell' | 'redeem'
  qty: number
  price: number // % от номинала; для redeem — 100
  nkd: number // НКД всего по сделке
  fee: number
  amount: number
  /** Для redeem: ключ события, чтобы не предлагать его повторно. */
  eventKey?: string
  /** Погашение при наступлении срока: бумаги выбывают со счёта. */
  closes?: boolean
}

/** Отметка, что событие (купон/погашение) пропущено пользователем. */
export interface BondMark { key: string; status: 'dismissed' }

// ---------- Московская биржа ----------

type Fetcher = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>
const ISS = 'https://iss.moex.com/iss'

async function iss(fetcher: Fetcher, path: string): Promise<Record<string, { columns: string[]; data: unknown[][] }>> {
  const res = await fetcher(`${ISS}${path}${path.includes('?') ? '&' : '?'}iss.meta=off`)
  if (!res.ok) throw new Error('Биржа не ответила')
  const text = (await res.text()).replace(/^﻿/, '')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Биржа вернула ошибку, попробуй позже')
  }
}

const rows = <T extends Record<string, unknown>>(block?: { columns: string[]; data: unknown[][] }): T[] =>
  block ? block.data.map(r => Object.fromEntries(block.columns.map((c, i) => [c, r[i]])) as T) : []

const kop = (rub: unknown) => (typeof rub === 'number' ? Math.round(rub * 100) : 0)

export interface BondSearchItem { secid: string; shortName: string; isin: string; boardId: string }

export async function searchBonds(q: string, fetcher: Fetcher = fetch): Promise<BondSearchItem[]> {
  const d = await iss(fetcher, `/securities.json?q=${encodeURIComponent(q)}&securities.columns=secid,shortname,isin,group,primary_boardid,is_traded&limit=30`)
  return rows<{ secid: string; shortname: string; isin: string; group: string; primary_boardid: string; is_traded: number }>(d.securities)
    .filter(r => r.group === 'stock_bonds')
    .sort((a, b) => b.is_traded - a.is_traded)
    .map(r => ({ secid: r.secid, shortName: r.shortname, isin: r.isin, boardId: r.primary_boardid }))
}

/** Полные данные бумаги: котировка, НКД, купоны и погашения (с постраничной загрузкой графика). */
export async function fetchBond(secid: string, fetcher: Fetcher = fetch): Promise<Bond> {
  const quote = await iss(fetcher, `/engines/stock/markets/bonds/securities/${secid}.json?iss.only=securities,marketdata`
    + '&securities.columns=SECID,BOARDID,SHORTNAME,ISIN,FACEVALUE,FACEUNIT,ACCRUEDINT,MATDATE,PREVPRICE'
    + '&marketdata.columns=SECID,BOARDID,LAST,MARKETPRICE,LCURRENTPRICE')
  const secs = rows<{ BOARDID: string; SHORTNAME: string; ISIN: string; FACEVALUE: number; FACEUNIT: string; ACCRUEDINT: number; MATDATE: string | null; PREVPRICE: number | null }>(quote.securities)
  if (!secs.length) throw new Error('Бумага не найдена на бирже')
  const md = rows<{ BOARDID: string; LAST: number | null; MARKETPRICE: number | null; LCURRENTPRICE: number | null }>(quote.marketdata)
  // Основной режим торгов: где есть цена; T+ для облигаций — TQOB/TQCB/TQIR и т.п.
  const s = secs.find(x => md.some(m => m.BOARDID === x.BOARDID && (m.LAST ?? m.MARKETPRICE ?? m.LCURRENTPRICE))) ?? secs[0]
  const m = md.find(x => x.BOARDID === s.BOARDID)
  if (s.FACEUNIT !== 'SUR' && s.FACEUNIT !== 'RUB') throw new Error('Пока поддерживаются только рублёвые облигации')

  const coupons: Bond['coupons'] = []
  const redemptions: Bond['redemptions'] = []
  for (let start = 0, total = 1; start < total; start += 100) {
    const d = await iss(fetcher, `/statistics/engines/stock/markets/bonds/bondization/${secid}.json?iss.only=coupons,coupons.cursor,amortizations&limit=100&start=${start}`)
    for (const c of rows<{ coupondate: string; recorddate: string | null; value_rub: number | null }>(d.coupons)) {
      coupons.push({ date: c.coupondate, recordDate: c.recorddate ?? c.coupondate, value: c.value_rub == null ? null : kop(c.value_rub) })
    }
    if (start === 0) {
      for (const a of rows<{ amortdate: string; value_rub: number; data_source: string }>(d.amortizations)) {
        redemptions.push({ date: a.amortdate, value: kop(a.value_rub), kind: a.data_source === 'maturity' ? 'maturity' : a.data_source === 'offer' ? 'offer' : 'amortization' })
      }
    }
    total = rows<{ TOTAL: number }>(d['coupons.cursor'])[0]?.TOTAL ?? 0
  }

  return {
    secid, isin: s.ISIN, shortName: s.SHORTNAME, boardId: s.BOARDID,
    face: kop(s.FACEVALUE), price: m?.LAST ?? m?.MARKETPRICE ?? m?.LCURRENTPRICE ?? s.PREVPRICE ?? null,
    accrued: kop(s.ACCRUEDINT), matDate: s.MATDATE, coupons, redemptions: redemptions.filter(r => r.kind !== 'offer'),
    updatedAt: Date.now(),
  }
}

// ---------- Позиции ----------

export const COUPON_TAX = 0.13

/** Количество бумаг на счёте на конец дня `date`. Частичное погашение номинала количество не меняет, полное — закрывает. */
export function qtyAt(trades: Trade[], accountId: number, secid: string, date: string): number {
  let q = 0
  for (const t of trades) {
    if (t.accountId !== accountId || t.secid !== secid || t.date > date) continue
    if (t.type === 'buy') q += t.qty
    else if (t.type === 'sell' || t.closes) q -= t.qty
  }
  return q
}

export interface Position {
  accountId: number
  secid: string
  qty: number
  invested: number // вложено чистыми: покупки − продажи − погашения
  value: number // рыночная стоимость с НКД
  coupons: number // полученные купоны (записанные доходы)
  profit: number // value + coupons − invested
  bond?: Bond
}

export function positions(trades: Trade[], bonds: Bond[], txs: Tx[], today: string): Position[] {
  const keys = [...new Set(trades.map(t => `${t.accountId}|${t.secid}`))]
  return keys.map(k => {
    const [acc, secid] = k.split('|')
    const accountId = Number(acc)
    const own = trades.filter(t => t.accountId === accountId && t.secid === secid)
    const bond = bonds.find(b => b.secid === secid)
    const qty = qtyAt(trades, accountId, secid, today)
    const invested = own.reduce((s, t) => s + (t.type === 'buy' ? t.amount : -t.amount), 0)
    const matured = !!bond?.matDate && bond.matDate < today
    const value = bond && bond.price != null && !matured ? Math.round(qty * (bond.face * bond.price / 100 + bond.accrued)) : 0
    const coupons = txs.filter(t => t.type === 'income' && t.accountId === accountId && t.secid === secid).reduce((s, t) => s + t.amount, 0)
    return { accountId, secid, qty, invested, value, coupons, profit: value + coupons - invested, bond }
  }).filter(p => p.qty > 0 || p.invested !== 0)
}

/** Стоимость бумаг по счетам (₽). */
export function bondValueByAccount(ps: Position[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const p of ps) m.set(p.accountId, (m.get(p.accountId) ?? 0) + p.value)
  return m
}

// ---------- Купоны и погашения ----------

export interface BondEvent {
  key: string
  accountId: number
  secid: string
  shortName: string
  kind: 'coupon' | 'redemption'
  date: string
  qty: number
  /** На руки: купон за вычетом налога (если счёт не освобождён), погашение — целиком. null — купон ещё не объявлен. */
  amount: number | null
  estimated: boolean // сумма по последнему известному купону
}

export const eventKey = (accountId: number, secid: string, kind: string, date: string) => `${accountId}|${secid}|${kind}|${date}`

/** События по бумагам на счетах в интервале дат (включительно). */
export function bondEvents(trades: Trade[], bonds: Bond[], from: string, to: string, taxFree: (accountId: number) => boolean): BondEvent[] {
  const res: BondEvent[] = []
  const keys = [...new Set(trades.map(t => `${t.accountId}|${t.secid}`))]
  for (const k of keys) {
    const [acc, secid] = k.split('|')
    const accountId = Number(acc)
    const bond = bonds.find(b => b.secid === secid)
    if (!bond) continue
    let lastKnown: number | null = null
    for (const c of bond.coupons) {
      if (c.value != null) lastKnown = c.value
      if (c.date < from || c.date > to) continue
      const qty = qtyAt(trades, accountId, secid, c.recordDate)
      if (qty <= 0) continue
      const per = c.value ?? lastKnown
      const gross = per == null ? null : qty * per
      res.push({
        key: eventKey(accountId, secid, 'coupon', c.date), accountId, secid, shortName: bond.shortName, kind: 'coupon', date: c.date, qty,
        amount: gross == null ? null : taxFree(accountId) ? gross : Math.round(gross * (1 - COUPON_TAX)), estimated: c.value == null,
      })
    }
    for (const r of bond.redemptions) {
      if (r.date < from || r.date > to) continue
      const qty = qtyAt(trades, accountId, secid, r.date)
      if (qty <= 0) continue
      res.push({ key: eventKey(accountId, secid, 'redemption', r.date), accountId, secid, shortName: bond.shortName, kind: 'redemption', date: r.date, qty, amount: qty * r.value, estimated: false })
    }
  }
  return res.sort((a, b) => a.date.localeCompare(b.date))
}

/** Наступившие и ещё не записанные/не пропущенные события — для плашки «Пришёл купон». */
export function pendingBondEvents(trades: Trade[], bonds: Bond[], txs: Tx[], marks: BondMark[], today: string, taxFree: (id: number) => boolean): BondEvent[] {
  const first = trades.map(t => t.date).sort()[0]
  if (!first) return []
  const done = new Set<string>([
    ...txs.map(t => t.eventKey).filter((k): k is string => !!k),
    ...trades.map(t => t.eventKey).filter((k): k is string => !!k),
    ...marks.map(m => m.key),
  ])
  return bondEvents(trades, bonds, first, today, taxFree).filter(e => !done.has(e.key))
}
