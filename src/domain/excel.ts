import ExcelJS from 'exceljs'
import { BACKUP_TABLES, type BackupTable, type FinanceDB } from '../db'
import { balances, envelopes, fxLoss, goalProgress, rootOf } from './calc'
import { monthOf, shiftMonth, todayISO, toMajor } from './money'
import { convertToRub } from './rates'
import { INCOME_LABEL, type Rate } from './types'

const BACKUP_SHEET = '_backup'
const BACKUP_VERSION = 1
const CHUNK = 30000 // лимит ячейки Excel — 32 767 символов
const RUB_FMT = '#,##0.00 "₽"'
const NUM_FMT = '#,##0.00'

type Snapshot = { version: number; exportedAt: number; tables: Record<BackupTable, unknown[]> }

async function snapshot(db: FinanceDB): Promise<Snapshot> {
  const tables = {} as Record<BackupTable, unknown[]>
  for (const t of BACKUP_TABLES) tables[t] = await db.table(t).toArray()
  return { version: BACKUP_VERSION, exportedAt: Date.now(), tables }
}

function addTable(
  wb: ExcelJS.Workbook,
  sheetName: string,
  columns: { name: string; width?: number; fmt?: string }[],
  rows: unknown[][],
) {
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addTable({
    name: sheetName.replace(/\s/g, '_'),
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: columns.map(c => ({ name: c.name, filterButton: true })),
    rows: rows.length ? rows : [columns.map(() => null)],
  })
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = c.width ?? 14
    if (c.fmt) col.numFmt = c.fmt
  })
}

/** Excel-файл: читаемые листы для анализа + скрытый лист с полной копией для восстановления. */
export async function exportWorkbook(db: FinanceDB): Promise<ArrayBuffer> {
  const snap = await snapshot(db)
  const [accounts, categories, txs, limits, goals, rates] = await Promise.all([
    db.accounts.toArray(), db.categories.toArray(), db.txs.orderBy('date').toArray(),
    db.limits.toArray(), db.goals.toArray(), db.rates.orderBy('date').toArray(),
  ])
  const latest: Rate | null = rates.at(-1) ?? null
  const acc = new Map(accounts.map(a => [a.id!, a]))
  const cat = new Map(categories.map(c => [c.id!, c]))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Финансы'
  wb.created = new Date()

  const TYPE = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' } as const
  addTable(wb, 'Операции', [
    { name: 'Дата', width: 12, fmt: 'dd.mm.yyyy' }, { name: 'Тип', width: 10 }, { name: 'Счёт', width: 16 },
    { name: 'Валюта', width: 8 }, { name: 'Сумма', fmt: NUM_FMT }, { name: 'Сумма ₽', fmt: RUB_FMT },
    { name: 'Категория', width: 20 }, { name: 'Подкатегория', width: 16 },
    { name: 'Вид дохода', width: 14 }, { name: 'Счёт зачисления', width: 16 }, { name: 'Сумма зачисления', fmt: NUM_FMT },
    { name: 'Разница курса ₽', fmt: RUB_FMT }, { name: 'Комментарий', width: 30 },
  ], txs.map(t => {
    const c = t.categoryId != null ? cat.get(t.categoryId) : undefined
    const root = rootOf(categories, t.categoryId)
    return [
      new Date(t.date + 'T00:00:00Z'), TYPE[t.type], acc.get(t.accountId)?.name ?? '', acc.get(t.accountId)?.currency ?? '',
      toMajor(t.amount), toMajor(t.rub),
      root?.name ?? null, c && c.parentId != null ? c.name : null,
      t.incomeKind ? INCOME_LABEL[t.incomeKind] : null,
      t.toAccountId != null ? acc.get(t.toAccountId)?.name ?? '' : null,
      t.toAmount != null ? toMajor(t.toAmount) : null,
      t.type === 'transfer' ? toMajor(fxLoss(t)) : null,
      t.comment || null,
    ]
  }))

  const bal = balances(accounts, txs)
  addTable(wb, 'Счета', [
    { name: 'Счёт', width: 20 }, { name: 'Валюта', width: 8 }, { name: 'Баланс', fmt: NUM_FMT }, { name: 'Баланс ₽', fmt: RUB_FMT },
  ], accounts.filter(a => !a.archived).map(a => {
    const b = bal.get(a.id!) ?? 0
    const rub = convertToRub(b, a.currency, latest)
    return [a.name, a.currency, toMajor(b), rub == null ? null : toMajor(rub)]
  }))

  const budgetRows: unknown[][] = []
  const firstMonth = [txs[0]?.date, ...limits.map(l => l.month)].filter(Boolean).map(d => monthOf(d!)).sort()[0]
  if (firstMonth) {
    for (let m = firstMonth; m <= monthOf(todayISO()); m = shiftMonth(m, 1)) {
      for (const e of envelopes(categories, limits, txs, m)) {
        if (!e.limit && !e.spent) continue
        budgetRows.push([m, e.category.name, toMajor(e.limit), toMajor(e.spent), toMajor(e.available)])
      }
    }
  }
  addTable(wb, 'Бюджет', [
    { name: 'Месяц', width: 10 }, { name: 'Конверт', width: 22 },
    { name: 'Лимит ₽', fmt: RUB_FMT }, { name: 'Потрачено ₽', fmt: RUB_FMT }, { name: 'Доступно ₽', fmt: RUB_FMT },
  ], budgetRows)

  addTable(wb, 'Цели', [
    { name: 'Цель', width: 20 }, { name: 'Счёт', width: 16 }, { name: 'Валюта', width: 8 },
    { name: 'Цель, сумма', fmt: NUM_FMT }, { name: 'Накоплено', fmt: NUM_FMT }, { name: 'Осталось', fmt: NUM_FMT }, { name: 'Прогресс', fmt: '0%' },
  ], goalProgress(goals, bal).map(p => {
    const a = acc.get(p.goal.accountId)
    return [p.goal.name, a?.name ?? '', a?.currency ?? '', toMajor(p.goal.target), toMajor(p.saved), toMajor(p.remaining), p.goal.target ? p.saved / p.goal.target : 0]
  }))

  addTable(wb, 'Курсы', [
    { name: 'Дата', width: 12, fmt: 'dd.mm.yyyy' }, { name: 'USD', fmt: '0.0000' }, { name: 'EUR', fmt: '0.0000' },
  ], rates.map(r => [new Date(r.date + 'T00:00:00Z'), r.USD, r.EUR]))

  const hidden = wb.addWorksheet(BACKUP_SHEET, { state: 'veryHidden' })
  const json = JSON.stringify(snap)
  for (let i = 0; i * CHUNK < json.length; i++) hidden.getCell(i + 1, 1).value = json.slice(i * CHUNK, (i + 1) * CHUNK)

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export class ImportError extends Error {}

/** Полностью заменяет данные содержимым бэкапа. Настройки блокировки устройства не трогает. */
export async function importWorkbook(db: FinanceDB, data: ArrayBuffer): Promise<{ txs: number }> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(data)
  } catch {
    throw new ImportError('Это не Excel-файл')
  }
  const ws = wb.getWorksheet(BACKUP_SHEET)
  if (!ws) throw new ImportError('В файле нет данных для восстановления — нужен файл, выгруженный из этого приложения')
  let json = ''
  for (let i = 1; i <= ws.rowCount; i++) json += String(ws.getCell(i, 1).value ?? '')
  let snap: Snapshot
  try {
    snap = JSON.parse(json)
  } catch {
    throw new ImportError('Данные в файле повреждены')
  }
  if (snap.version > BACKUP_VERSION) throw new ImportError('Файл создан более новой версией приложения — обнови приложение')

  await db.transaction('rw', BACKUP_TABLES.map(t => db.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(snap.tables[t] ?? [])
    }
  })
  return { txs: snap.tables.txs?.length ?? 0 }
}
