import { describe, expect, it } from 'vitest'
import { FinanceDB } from '../db'
import { balances } from './calc'
import { applyCoinKeeper, CkError, parseCsv, previewCoinKeeper } from './coinkeeper'
import { seedIfEmpty } from './seed'

let n = 0
const freshDb = async () => { const db = new FinanceDB(`ck-${n++}`); await seedIfEmpty(db); return db }

// Вымышленные данные в формате выгрузки CoinKeeper.
const CSV = `Date,Type,From,To,Tags,Amount,Currency,Amount converted,Currency of conversion,Recurrence,Note
28.09.2026,expense,Карта,"Непредвиденные ",,1964.80,RUB,,,false,
28.09.2026,expense,Карта,Продукты,,120.00,RUB,,,false,
28.09.2026,expense,Карта,Продукты,,120.00,RUB,,,false,
28.09.2026,transfer,Карта,Копилка машина,,43.50,RUB,,,false,
27.09.2026,expense,Копилка жильё,Квартира,,30000.00,RUB,,,false,"за октябрь, ""досрочно"""
13.09.2026,income,Зарплата,Карта,,53542.86,RUB,,,false,
12.09.2026,income,Проценты,Копилка жильё,,101.58,RUB,,,false,
11.09.2026,income,Кешбэк от банка,Карта,,15.00,RUB,,,false,
10.09.2026,expense,Карта,Кафе,,10.00,USD,,,false,
`

describe('CSV', () => {
  it('кавычки, запятые и "" внутри поля', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']])
  })
})

describe('импорт CoinKeeper', () => {
  it('предпросмотр: счета, категории с догадкой о типе, источники дохода, неподдерживаемые валюты', async () => {
    const db = await freshDb()
    const p = await previewCoinKeeper(db, CSV)
    expect(p.from).toBe('2026-09-11')
    expect(p.to).toBe('2026-09-28')
    expect(p.unsupported).toBe(1)
    expect(p.accounts.map(a => [a.name, a.exists])).toEqual([['Карта', true], ['Копилка жильё', false], ['Копилка машина', false]])
    expect(p.categories.map(c => [c.name, c.bucket, c.exists])).toEqual([
      ['Квартира', 'needs', false], ['Непредвиденные', 'wants', false], ['Продукты', 'needs', true],
    ])
    expect(p.incomeSources.map(s => [s.name, s.kind])).toEqual([['Зарплата', 'salary'], ['Проценты', 'interest'], ['Кешбэк от банка', 'interest']])
  })

  it('переносит операции, а повторный импорт не создаёт дублей (в т.ч. одинаковых в один день)', async () => {
    const db = await freshDb()
    const before = await db.txs.count()
    const p = await previewCoinKeeper(db, CSV)
    const r1 = await applyCoinKeeper(db, p, { Непредвиденные: 'needs' })
    expect(r1).toMatchObject({ added: 8, duplicates: 0, accountsCreated: 2, categoriesCreated: 2 })
    expect(await db.txs.count()).toBe(before + 8)

    const cat = (await db.categories.toArray()).find(c => c.name === 'Непредвиденные')!
    expect(cat.bucket).toBe('needs')
    const rent = (await db.txs.toArray()).find(t => t.amount === 3000000)!
    expect(rent.comment).toBe('за октябрь, "досрочно"')
    const interest = (await db.txs.toArray()).filter(t => t.incomeKind === 'interest')
    expect(interest).toHaveLength(2)
    expect(interest.find(t => t.amount === 1500)!.comment).toBe('Кешбэк от банка')

    const r2 = await applyCoinKeeper(db, await previewCoinKeeper(db, CSV), {})
    expect(r2).toMatchObject({ added: 0, duplicates: 8, accountsCreated: 0, categoriesCreated: 0 })

    // Новая выгрузка с ещё одной покупкой за 120 — добавится только она.
    const more = CSV.replace('28.09.2026,expense,Карта,Продукты,,120.00', '28.09.2026,expense,Карта,Продукты,,120.00,RUB,,,false,\n28.09.2026,expense,Карта,Продукты,,120.00')
    const r3 = await applyCoinKeeper(db, await previewCoinKeeper(db, more), {})
    expect(r3).toMatchObject({ added: 1, duplicates: 8 })
  })

  it('балансы после импорта считаются по операциям', async () => {
    const db = await freshDb()
    await applyCoinKeeper(db, await previewCoinKeeper(db, CSV), {})
    const accs = await db.accounts.toArray()
    const bal = balances(accs, await db.txs.toArray())
    const byName = (n: string) => bal.get(accs.find(a => a.name === n)!.id!)
    expect(byName('Копилка жильё')).toBe(-3000000 + 10158)
    expect(byName('Копилка машина')).toBe(4350)
  })

  it('понятная ошибка на чужой файл', async () => {
    const db = await freshDb()
    await expect(previewCoinKeeper(db, 'a,b,c\n1,2,3')).rejects.toBeInstanceOf(CkError)
  })
})
