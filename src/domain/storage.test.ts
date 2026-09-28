import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { BACKUP_TABLES, FinanceDB, getSettings, saveSettings } from '../db'
import { exportWorkbook, ImportError, importWorkbook } from './excel'
import { convertToRub, rateFor } from './rates'
import { seedIfEmpty } from './seed'

let n = 0
const freshDb = () => new FinanceDB(`test-${n++}`)

async function dump(db: FinanceDB) {
  const res: Record<string, unknown[]> = {}
  for (const t of BACKUP_TABLES) res[t] = await db.table(t).toArray()
  return res
}

describe('Excel: экспорт → импорт', () => {
  it('восстанавливает все данные идентично и не трогает блокировку устройства', async () => {
    const a = freshDb()
    await seedIfEmpty(a)
    const usd = await a.accounts.add({ name: 'Доллары', currency: 'USD', openingBalance: 0, archived: false, order: 1 })
    await a.txs.add({ date: '2026-09-01', type: 'expense', accountId: 1, amount: 150000, rub: 150000, categoryId: 3, comment: 'кофе "Штолле"; 😀', createdAt: 1 })
    await a.txs.add({ date: '2026-09-02', type: 'transfer', accountId: 1, amount: 950000, rub: 950000, toAccountId: usd, toAmount: 10000, toRub: 920000, comment: '', createdAt: 2 })
    // много операций, чтобы JSON занял несколько ячеек
    await a.txs.bulkAdd(Array.from({ length: 800 }, (_, i) => ({
      date: '2026-08-15', type: 'expense' as const, accountId: 1, amount: 100 + i, rub: 100 + i, categoryId: 5, comment: `операция ${i}`, createdAt: i,
    })))
    await a.limits.add({ categoryId: 1, month: '2026-09', amount: 3000000 })
    await a.goals.add({ name: 'Подушка', target: 30000000, accountId: 1, priority: 0 })
    await a.rates.put({ date: '2026-09-02', USD: 92, EUR: 100 })
    await saveSettings({ expectedSalary: 6000000 }, a)

    const file = await exportWorkbook(a)

    const b = freshDb()
    await b.lock.put({ key: 'lock', credentialId: 'dev', pinHash: 'h', pinSalt: 's' })
    await b.txs.add({ date: '2020-01-01', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: 'старое', createdAt: 0 })
    const res = await importWorkbook(b, file)

    expect(res.txs).toBe(802)
    expect(await dump(b)).toEqual(await dump(a))
    expect((await getSettings(b)).expectedSalary).toBe(6000000)
    expect(await b.lock.get('lock')).toMatchObject({ credentialId: 'dev' })
  })

  it('читаемые листы на месте и оформлены таблицами', async () => {
    const a = freshDb()
    await seedIfEmpty(a)
    await a.txs.add({ date: '2026-09-01', type: 'expense', accountId: 1, amount: 150000, rub: 150000, categoryId: 2, comment: '', createdAt: 1 })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportWorkbook(a))
    expect(wb.worksheets.filter(w => w.state === 'visible').map(w => w.name)).toEqual(['Операции', 'Счета', 'Бюджет', 'Цели', 'Курсы'])
    const ops = wb.getWorksheet('Операции')!
    expect(ops.getRow(2).getCell(6).value).toBe(1500)
    expect(ops.getRow(2).getCell(7).value).toBe('Жильё')
    expect(ops.getRow(2).getCell(8).value).toBe('Аренда')
    expect(ops.getTables().length).toBe(1)
  })

  it('понятная ошибка на чужой файл', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Лист1')
    await expect(importWorkbook(freshDb(), (await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toBeInstanceOf(ImportError)
    await expect(importWorkbook(freshDb(), new ArrayBuffer(10))).rejects.toThrow('Это не Excel-файл')
  })
})

describe('курсы ЦБ', () => {
  const cbr = (date: string, usd: number) => ({ Date: `${date}T11:30:00+03:00`, Valute: { USD: { Nominal: 1, Value: usd }, EUR: { Nominal: 1, Value: usd + 10 } } })

  it('берёт архив, откатываясь с выходных', async () => {
    const db = freshDb()
    const calls: string[] = []
    const fetcher = async (url: string) => {
      calls.push(url)
      const ok = url.includes('/2026/09/26/')
      return { ok, json: async () => cbr('2026-09-26', 81.5) }
    }
    const r = await rateFor(db, '2026-09-27', fetcher)
    expect(r).toMatchObject({ date: '2026-09-27', USD: 81.5 })
    expect(calls).toHaveLength(2)
    // второй раз — из кэша
    await rateFor(db, '2026-09-27', fetcher)
    expect(calls).toHaveLength(2)
    expect(convertToRub(10000, 'USD', r)).toBe(815000)
  })

  it('без сети — последний известный курс', async () => {
    const db = freshDb()
    await db.rates.put({ date: '2026-09-20', USD: 80, EUR: 90 })
    const offline = async () => { throw new TypeError('Failed to fetch') }
    expect(await rateFor(db, '2026-09-27', offline)).toMatchObject({ USD: 80 })
  })
})
