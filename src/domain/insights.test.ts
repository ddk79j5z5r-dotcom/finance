import { describe, expect, it } from 'vitest'
import {
  averageCumulative, averageDailySpend, capitalMilestone, categoryDeltas, cumulativeSpend, previousMonths, reserveDays, topCategories,
} from './insights'
import type { Category, Tx } from './types'

const R = (rub: number) => rub * 100
let id = 1
const tx = (date: string, rub: number, categoryId = 1, p: Partial<Tx> = {}): Tx => ({
  id: id++, date, type: 'expense', accountId: 1, amount: R(rub), rub: R(rub), comment: '', createdAt: 0, categoryId, ...p,
})
const cats: Category[] = [
  { id: 1, name: 'Продукты', parentId: null, bucket: 'needs', archived: false },
  { id: 2, name: 'Транспорт', parentId: null, bucket: 'needs', archived: false },
  { id: 3, name: 'Метро', parentId: 2, bucket: 'needs', archived: false },
]

describe('траты к этому дню', () => {
  const txs = [
    // август и сентябрь — база среднего; февраль-подобный короткий месяц не нужен
    tx('2026-08-02', 1000), tx('2026-08-20', 3000, 3),
    tx('2026-09-02', 3000), tx('2026-09-30', 1000, 2),
    tx('2026-10-01', 500), tx('2026-10-03', 4000, 3),
    tx('2026-10-05', 0, 1, { type: 'transfer', toAccountId: 2, amount: R(100), rub: R(100), toAmount: R(1), toRub: R(90) }), // потеря 10 ₽ на обмене
    tx('2026-10-05', 9999, 1, { type: 'income' }),
  ]

  it('нарастающий итог по дням, с разницей курса, без доходов', () => {
    const c = cumulativeSpend(txs, '2026-10')
    expect(c).toHaveLength(31)
    expect(c.slice(0, 5)).toEqual([R(500), R(500), R(4500), R(4500), R(4510)])
    expect(c[30]).toBe(R(4510))
  })

  it('среднее — по прошлым месяцам с тратами', () => {
    expect(previousMonths(txs, '2026-10')).toEqual(['2026-09', '2026-08'])
    const avg = averageCumulative(txs, '2026-10')!
    expect(avg[1]).toBe(R(2000)) // ко 2-му: (3000 + 1000) / 2
    expect(avg[29]).toBe(R(4000)) // к 30-му: (4000 + 4000) / 2
    expect(avg[30]).toBe(R(4000)) // 31-го в сентябре нет — берётся его итог
    expect(averageCumulative([], '2026-10')).toBeNull()
  })

  it('категории к этому дню против среднего, подкатегории — в родителя', () => {
    const d = categoryDeltas(cats, txs, '2026-10', 5)
    expect(d.map(x => [x.category.name, x.now, x.avg, x.diff])).toEqual([
      ['Транспорт', R(4000), 0, R(4000)],
      ['Продукты', R(500), R(2000), R(-1500)],
    ])
  })

  it('чаще и больше всего', () => {
    const many = [...txs, tx('2026-10-04', 100), tx('2026-10-04', 100)]
    expect(topCategories(cats, many, '2026-10', 31, 'count').map(x => [x.category.name, x.count])).toEqual([['Продукты', 3], ['Транспорт', 1]])
    expect(topCategories(cats, many, '2026-10', 31, 'sum').map(x => [x.category.name, x.rub])).toEqual([['Транспорт', R(4000)], ['Продукты', R(700)]])
  })

  it('средний расход в день и запас в днях', () => {
    expect(averageDailySpend(txs, '2026-10-05')).toBe(Math.round(R(8000) / 61))
    expect(averageDailySpend([tx('2026-10-01', 600)], '2026-10-03')).toBe(R(200))
    expect(reserveDays(R(10000), R(300))).toBe(33)
    expect(reserveDays(R(10000), 0)).toBeNull()
  })
})

describe('новая финансовая высота', () => {
  it('круглая отметка выше прошлых максимумов', () => {
    expect(capitalMilestone(R(170723), [R(120000), R(140000)])).toBe(R(150000))
    expect(capitalMilestone(R(170723), [R(160000)])).toBeNull()
    expect(capitalMilestone(R(43000), [R(35000)])).toBe(R(40000))
    expect(capitalMilestone(R(1_230_000), [R(900000)])).toBe(R(1_200_000))
  })
})
