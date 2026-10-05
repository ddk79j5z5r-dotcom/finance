import Dexie, { type EntityTable } from 'dexie'
import type { Bond, BondMark, Trade } from './domain/bonds'
import type { Account, Allocation, Category, Goal, Limit, Rate, Recurring, Settings, Tx } from './domain/types'
import { DEFAULT_SETTINGS } from './domain/types'

export interface SettingsRow extends Settings {
  key: 'main'
}

/** Настройки блокировки хранятся отдельно: они привязаны к устройству и не попадают в бэкап. */
export interface LockRow {
  key: 'lock'
  credentialId: string | null
  pinHash: string | null
  pinSalt: string | null
}

export class FinanceDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  categories!: EntityTable<Category, 'id'>
  txs!: EntityTable<Tx, 'id'>
  limits!: EntityTable<Limit, 'id'>
  recurring!: EntityTable<Recurring, 'id'>
  goals!: EntityTable<Goal, 'id'>
  allocations!: EntityTable<Allocation, 'id'>
  rates!: EntityTable<Rate, 'date'>
  settings!: EntityTable<SettingsRow, 'key'>
  lock!: EntityTable<LockRow, 'key'>
  bonds!: EntityTable<Bond, 'secid'>
  trades!: EntityTable<Trade, 'id'>
  bondMarks!: EntityTable<BondMark, 'key'>

  constructor(name = 'finance') {
    super(name)
    this.version(1).stores({
      accounts: '++id, order',
      categories: '++id, parentId',
      txs: '++id, date, accountId, toAccountId, categoryId, type',
      limits: '++id, categoryId, month',
      recurring: '++id',
      goals: '++id, accountId',
      allocations: '++id, &txId, month',
      rates: 'date',
      settings: 'key',
      lock: 'key',
    })
    // v2: облигации — кэш данных биржи, сделки и пропущенные события.
    this.version(2).stores({
      bonds: 'secid',
      trades: '++id, accountId, secid, date',
      bondMarks: 'key',
    })
  }
}

export const db = new FinanceDB()

export async function getSettings(d: FinanceDB = db): Promise<Settings> {
  const row = await d.settings.get('main')
  return { ...DEFAULT_SETTINGS, ...row }
}

export async function saveSettings(patch: Partial<Settings>, d: FinanceDB = db) {
  const cur = await getSettings(d)
  await d.settings.put({ ...cur, ...patch, key: 'main' })
}

/** Все таблицы, которые входят в бэкап. */
export const BACKUP_TABLES = ['accounts', 'categories', 'txs', 'limits', 'recurring', 'goals', 'allocations', 'rates', 'settings', 'trades', 'bonds', 'bondMarks'] as const
export type BackupTable = (typeof BACKUP_TABLES)[number]
