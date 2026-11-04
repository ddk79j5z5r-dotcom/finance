import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { BACKUP_TABLES, FinanceDB } from '../db'
import { exportWorkbook, ImportError, importWorkbook } from './excel'

let n = 0
const freshDb = () => new FinanceDB(`excel-test-${n++}`)

async function dump(db: FinanceDB) {
  const res: Record<string, unknown[]> = {}
  for (const t of BACKUP_TABLES) res[t] = await db.table(t).toArray()
  return res
}

/** Книга с одним скрытым листом `_backup`, в ячейках которого лежит заданный текст. */
async function workbookWithBackup(cells: string[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('_backup', { state: 'veryHidden' })
  cells.forEach((c, i) => { ws.getCell(i + 1, 1).value = c })
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

const snapshotJson = (version: number, txs: unknown[] = []) =>
  JSON.stringify({ version, exportedAt: 0, tables: { txs } })

describe('Excel: экспорт и скрытый лист _backup', () => {
  it('в файле есть сильно скрытый лист _backup', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportWorkbook(freshDb()))
    expect(wb.getWorksheet('_backup')?.state).toBe('veryHidden')
  })

  it('пустая база: экспорт → импорт даёт пустую базу', async () => {
    const a = freshDb()
    const b = freshDb()
    const res = await importWorkbook(b, await exportWorkbook(a))
    expect(res.txs).toBe(0)
    expect(await dump(b)).toEqual(await dump(a))
  })

  it('резервная копия длиннее лимита ячейки раскладывается на несколько ячеек', async () => {
    const a = freshDb()
    await a.txs.bulkAdd(Array.from({ length: 600 }, (_, i) => ({
      date: '2026-09-01', type: 'expense' as const, accountId: 1, amount: i, rub: i, comment: 'комментарий '.repeat(5), createdAt: i,
    })))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportWorkbook(a))
    const ws = wb.getWorksheet('_backup')!
    expect(ws.rowCount).toBeGreaterThan(1)
    for (let i = 1; i <= ws.rowCount; i++) expect(String(ws.getCell(i, 1).value).length).toBeLessThanOrEqual(30000)
  })

  it('читаемые листы отражают данные: счёт, баланс и курс', async () => {
    const a = freshDb()
    await a.accounts.add({ name: 'Основная карта', currency: 'RUB', openingBalance: 123456, archived: false, order: 0, kind: 'card' })
    await a.rates.put({ date: '2026-09-02', USD: 92.5, EUR: 100 })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await exportWorkbook(a))
    const acc = wb.getWorksheet('Счета')!
    expect(acc.getRow(2).getCell(1).value).toBe('Основная карта')
    expect(acc.getRow(2).getCell(3).value).toBe(1234.56)
    const rates = wb.getWorksheet('Курсы')!
    expect(rates.getRow(2).getCell(2).value).toBe(92.5)
  })
})

describe('Excel: импорт', () => {
  it('полностью заменяет существующие данные', async () => {
    const a = freshDb()
    await a.accounts.add({ name: 'Новый', currency: 'RUB', openingBalance: 0, archived: false, order: 0, kind: 'card' })
    const file = await exportWorkbook(a)

    const b = freshDb()
    await b.accounts.add({ name: 'Старый', currency: 'RUB', openingBalance: 5, archived: false, order: 0, kind: 'card' })
    await b.txs.add({ date: '2020-01-01', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: 'старое', createdAt: 0 })
    await importWorkbook(b, file)

    expect((await b.accounts.toArray()).map(x => x.name)).toEqual(['Новый'])
    expect(await b.txs.count()).toBe(0)
  })

  it('сохраняет кириллицу, эмодзи, кавычки и переводы строк в комментариях', async () => {
    const a = freshDb()
    const comment = 'Кофе "Штолле"; ёжик 😀\nвторая строка, \\ слэш'
    await a.txs.add({ date: '2026-09-01', type: 'expense', accountId: 1, amount: 100, rub: 100, comment, createdAt: 1 })
    const b = freshDb()
    await importWorkbook(b, await exportWorkbook(a))
    expect((await b.txs.toArray())[0].comment).toBe(comment)
  })

  it('возвращает количество импортированных операций', async () => {
    const buf = await workbookWithBackup([snapshotJson(1, [
      { id: 1, date: '2026-01-01', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: '', createdAt: 0 },
      { id: 2, date: '2026-01-02', type: 'expense', accountId: 1, amount: 2, rub: 2, comment: '', createdAt: 0 },
    ])])
    expect(await importWorkbook(freshDb(), buf)).toEqual({ txs: 2 })
  })

  it('склеивает JSON из нескольких ячеек', async () => {
    const json = snapshotJson(1, [{ id: 1, date: '2026-01-01', type: 'expense', accountId: 1, amount: 7, rub: 7, comment: 'x', createdAt: 0 }])
    const mid = Math.floor(json.length / 2)
    const db = freshDb()
    await importWorkbook(db, await workbookWithBackup([json.slice(0, mid), json.slice(mid)]))
    expect((await db.txs.toArray())[0].amount).toBe(7)
  })

  it('таблицы, которых нет в копии (старая версия), остаются пустыми', async () => {
    const db = freshDb()
    await db.goals.add({ name: 'Старая цель', target: 1, accountId: 1, priority: 0 })
    await importWorkbook(db, await workbookWithBackup([snapshotJson(1)]))
    expect(await db.goals.count()).toBe(0)
  })

  it('отказывает мусорному файлу с понятным сообщением', async () => {
    await expect(importWorkbook(freshDb(), new ArrayBuffer(10))).rejects.toThrow('Это не Excel-файл')
  })

  it('отказывает книге без листа _backup', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Операции')
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    await expect(importWorkbook(freshDb(), buf)).rejects.toThrow('В файле нет данных для восстановления')
  })

  it('отказывает при повреждённом JSON', async () => {
    const buf = await workbookWithBackup(['{"version":1,"tables":'])
    await expect(importWorkbook(freshDb(), buf)).rejects.toThrow('Данные в файле повреждены')
  })

  it('отказывает файлу от более новой версии приложения и не трогает данные', async () => {
    const db = freshDb()
    await db.txs.add({ date: '2020-01-01', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: 'моё', createdAt: 0 })
    const buf = await workbookWithBackup([snapshotJson(999)])
    await expect(importWorkbook(db, buf)).rejects.toBeInstanceOf(ImportError)
    expect(await db.txs.count()).toBe(1)
  })

  it('ошибка повреждённого JSON не стирает данные', async () => {
    const db = freshDb()
    await db.txs.add({ date: '2020-01-01', type: 'expense', accountId: 1, amount: 1, rub: 1, comment: 'моё', createdAt: 0 })
    await expect(importWorkbook(db, await workbookWithBackup(['не json']))).rejects.toBeInstanceOf(ImportError)
    expect(await db.txs.count()).toBe(1)
  })

  it('валидный JSON, не являющийся копией, даёт ImportError', async () => {
    await expect(importWorkbook(freshDb(), await workbookWithBackup(['null']))).rejects.toBeInstanceOf(ImportError)
  })
})
