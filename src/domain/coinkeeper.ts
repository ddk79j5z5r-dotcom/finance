import type { FinanceDB } from '../db'
import { INCOME_LABEL, type Bucket, type IncomeKind, type Tx } from './types'

/** Строка выгрузки CoinKeeper (CSV из «Настройки → Экспорт»). */
export interface CkRow {
  date: string // YYYY-MM-DD
  type: 'expense' | 'income' | 'transfer'
  from: string
  to: string
  amount: number // копейки
  currency: string
  note: string
}

export class CkError extends Error {}

/** Разбор CSV с кавычками (RFC 4180): запятые и переводы строк внутри "..." , "" — кавычка. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c !== '')) rows.push(row)
  return rows
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export function parseCoinKeeper(text: string): CkRow[] {
  const rows = parseCsv(text)
  const head = rows[0]?.map(h => h.trim().toLowerCase()) ?? []
  const col = (name: string) => head.indexOf(name)
  const idx = { date: col('date'), type: col('type'), from: col('from'), to: col('to'), amount: col('amount'), currency: col('currency'), note: col('note') }
  if (Object.values(idx).some(i => i < 0)) throw new CkError('Это не выгрузка CoinKeeper: нет нужных столбцов (Date, Type, From, To, Amount…)')

  return rows.slice(1).map((r, n) => {
    const [d, m, y] = (r[idx.date] ?? '').trim().split('.')
    const type = (r[idx.type] ?? '').trim() as CkRow['type']
    const amount = Math.round(Number((r[idx.amount] ?? '').replace(/\s/g, '').replace(',', '.')) * 100)
    if (!y || !['expense', 'income', 'transfer'].includes(type) || !Number.isFinite(amount)) {
      throw new CkError(`Не удалось разобрать строку ${n + 2}`)
    }
    return {
      date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
      type, amount,
      from: clean(r[idx.from] ?? ''), to: clean(r[idx.to] ?? ''),
      currency: (r[idx.currency] ?? 'RUB').trim() || 'RUB',
      note: clean(r[idx.note] ?? ''),
    }
  })
}

const INCOME_BY_NAME: [RegExp, IncomeKind][] = [
  [/^зарплат/i, 'salary'], [/^аванс/i, 'advance'], [/^преми/i, 'bonus'], [/^процент|кешбэк|кэшбэк/i, 'interest'],
  [/родител|подар/i, 'gift'],
]
export const incomeKindFor = (source: string): IncomeKind => INCOME_BY_NAME.find(([re]) => re.test(source))?.[1] ?? 'other'

const NEEDS = /квартир|жиль|аренд|кредит|ипотек|продукт|здоров|аптек|врач|связ|интернет|транспорт|коммун|жкх|одежд/i
export const guessBucket = (category: string): Bucket => (NEEDS.test(category) ? 'needs' : 'wants')

export interface CkPreview {
  rows: CkRow[]
  from: string
  to: string
  accounts: { name: string; exists: boolean }[]
  categories: { name: string; exists: boolean; bucket: Bucket; count: number; rub: number }[]
  incomeSources: { name: string; kind: IncomeKind; count: number }[]
  unsupported: number // не в рублях
}

const norm = (s: string) => s.trim().toLowerCase()

export async function previewCoinKeeper(db: FinanceDB, text: string): Promise<CkPreview> {
  const all = parseCoinKeeper(text)
  if (!all.length) throw new CkError('В файле нет операций')
  const rows = all.filter(r => r.currency === 'RUB')
  const [accounts, categories] = await Promise.all([db.accounts.toArray(), db.categories.toArray()])
  const accNames = new Set(accounts.map(a => norm(a.name)))
  const catByName = new Map(categories.filter(c => !c.system).map(c => [norm(c.name), c]))

  const accSet = new Set<string>()
  const cats = new Map<string, { count: number; rub: number }>()
  const sources = new Map<string, number>()
  for (const r of rows) {
    if (r.type === 'expense') {
      accSet.add(r.from)
      const c = cats.get(r.to) ?? { count: 0, rub: 0 }
      cats.set(r.to, { count: c.count + 1, rub: c.rub + r.amount })
    } else if (r.type === 'income') {
      accSet.add(r.to)
      sources.set(r.from, (sources.get(r.from) ?? 0) + 1)
    } else {
      accSet.add(r.from); accSet.add(r.to)
    }
  }
  const dates = rows.map(r => r.date).sort()
  return {
    rows,
    from: dates[0], to: dates.at(-1)!,
    accounts: [...accSet].sort().map(name => ({ name, exists: accNames.has(norm(name)) })),
    categories: [...cats].sort((a, b) => b[1].rub - a[1].rub).map(([name, v]) => {
      const existing = catByName.get(norm(name))
      return { name, exists: !!existing, bucket: existing?.bucket ?? guessBucket(name), ...v }
    }),
    incomeSources: [...sources].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, kind: incomeKindFor(name), count })),
    unsupported: all.length - rows.length,
  }
}

export interface CkResult { added: number; duplicates: number; accountsCreated: number; categoriesCreated: number; accountIds: number[] }

/**
 * Переносит операции. Счета и категории сопоставляются по имени, недостающие создаются.
 * Уже существующие операции (та же дата, тип, счета/категория и сумма) пропускаются —
 * повторный импорт пересекающейся выгрузки не создаёт дублей. Одинаковые операции в один день
 * учитываются по количеству.
 */
export async function applyCoinKeeper(db: FinanceDB, preview: CkPreview, buckets: Record<string, Bucket>): Promise<CkResult> {
  return db.transaction('rw', [db.accounts, db.categories, db.txs], async () => {
    const accounts = await db.accounts.toArray()
    const categories = await db.categories.toArray()
    const accId = new Map(accounts.map(a => [norm(a.name), a.id!]))
    const catId = new Map(categories.filter(c => !c.system).map(c => [norm(c.name), c.id!]))
    let accountsCreated = 0
    let categoriesCreated = 0

    let order = accounts.length
    for (const a of preview.accounts) {
      if (accId.has(norm(a.name))) continue
      const id = await db.accounts.add({ name: a.name, currency: 'RUB', openingBalance: 0, archived: false, order: order++ })
      accId.set(norm(a.name), id!)
      accountsCreated++
    }
    for (const c of preview.categories) {
      const id = catId.get(norm(c.name))
      if (id != null) {
        if (buckets[c.name] && buckets[c.name] !== c.bucket) await db.categories.update(id, { bucket: buckets[c.name] })
        continue
      }
      const newId = await db.categories.add({ name: c.name, parentId: null, bucket: buckets[c.name] ?? c.bucket, archived: false })
      catId.set(norm(c.name), newId!)
      categoriesCreated++
    }

    const sig = (t: Pick<Tx, 'date' | 'type' | 'accountId' | 'amount' | 'categoryId' | 'toAccountId' | 'incomeKind'>) =>
      [t.date, t.type, t.accountId, t.amount, t.type === 'expense' ? t.categoryId : t.type === 'transfer' ? t.toAccountId : t.incomeKind].join('|')
    const existing = new Map<string, number>()
    for (const t of await db.txs.toArray()) existing.set(sig(t), (existing.get(sig(t)) ?? 0) + 1)

    const toAdd: Tx[] = []
    let duplicates = 0
    const now = Date.now()
    preview.rows.forEach((r, i) => {
      const base = { date: r.date, amount: r.amount, rub: r.amount, createdAt: now - i, comment: '' }
      let t: Tx
      if (r.type === 'expense') {
        t = { ...base, type: 'expense', accountId: accId.get(norm(r.from))!, categoryId: catId.get(norm(r.to))!, comment: r.note }
      } else if (r.type === 'income') {
        const kind = incomeKindFor(r.from)
        t = { ...base, type: 'income', accountId: accId.get(norm(r.to))!, incomeKind: kind, comment: [norm(r.from) === norm(INCOME_LABEL[kind]) ? '' : r.from, r.note].filter(Boolean).join(' · ') }
      } else {
        t = { ...base, type: 'transfer', accountId: accId.get(norm(r.from))!, toAccountId: accId.get(norm(r.to))!, toAmount: r.amount, toRub: r.amount, comment: r.note }
      }
      const k = sig(t)
      const left = existing.get(k) ?? 0
      if (left > 0) { existing.set(k, left - 1); duplicates++; return }
      toAdd.push(t)
    })
    await db.txs.bulkAdd(toAdd)
    return { added: toAdd.length, duplicates, accountsCreated, categoriesCreated, accountIds: [...new Set(preview.accounts.map(a => accId.get(norm(a.name))!))] }
  })
}
