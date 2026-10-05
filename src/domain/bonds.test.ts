import { describe, expect, it } from 'vitest'
import { balances, savedInMonth } from './calc'
import { bondEvents, fetchBond, pendingBondEvents, positions, qtyAt, searchBonds, type Bond, type Trade } from './bonds'
import type { Account, Tx } from './types'

const R = (rub: number) => Math.round(rub * 100)

// Фейковая биржа: ответы в формате ISS (columns + data), график купонов из 130 строк — проверка постраничной загрузки.
const coupons = Array.from({ length: 130 }, (_, i) => {
  const d = new Date(Date.UTC(2026, i, 15)).toISOString().slice(0, 10)
  return [d, d, i < 129 ? 10.5 : null]
})
function fakeFetch(url: string) {
  const json = (o: unknown) => Promise.resolve({ ok: true, text: () => Promise.resolve('﻿' + JSON.stringify(o)) })
  if (url.includes('/securities.json?q=')) {
    return json({ securities: { columns: ['secid', 'shortname', 'isin', 'group', 'primary_boardid', 'is_traded'], data: [
      ['SU1', 'ОФЗ 1', 'RU1', 'stock_bonds', 'TQOB', 1], ['SBER', 'Сбербанк', 'RU2', 'stock_shares', 'TQBR', 1], ['OLD', 'ОФЗ старая', 'RU3', 'stock_bonds', 'TQOB', 0],
    ] } })
  }
  if (url.includes('/bondization/')) {
    const start = Number(new URL(url).searchParams.get('start'))
    return json({
      coupons: { columns: ['coupondate', 'recorddate', 'value_rub'], data: coupons.slice(start, start + 100) },
      'coupons.cursor': { columns: ['INDEX', 'TOTAL', 'PAGESIZE'], data: [[start, 130, 100]] },
      amortizations: { columns: ['amortdate', 'value_rub', 'data_source'], data: [['2030-01-15', 500, 'amortization'], ['2036-10-15', 500, 'maturity'], ['2028-01-01', 1000, 'offer']] },
    })
  }
  return json({
    securities: { columns: ['SECID', 'BOARDID', 'SHORTNAME', 'ISIN', 'FACEVALUE', 'FACEUNIT', 'ACCRUEDINT', 'MATDATE', 'PREVPRICE'], data: [
      ['SU1', 'PACT', 'ОФЗ 1', 'RU1', 1000, 'SUR', 5.5, '2036-10-15', 90], ['SU1', 'TQOB', 'ОФЗ 1', 'RU1', 1000, 'SUR', 5.5, '2036-10-15', 95],
    ] },
    marketdata: { columns: ['SECID', 'BOARDID', 'LAST', 'MARKETPRICE', 'LCURRENTPRICE'], data: [['SU1', 'PACT', null, null, null], ['SU1', 'TQOB', 96.5, 96.4, 96.45]] },
  })
}

describe('Московская биржа', () => {
  it('поиск — только облигации, торгуемые первыми', async () => {
    expect((await searchBonds('офз', fakeFetch)).map(b => b.secid)).toEqual(['SU1', 'OLD'])
  })

  it('бумага: цена основного режима, НКД, весь график (130 купонов), без оферт', async () => {
    const b = await fetchBond('SU1', fakeFetch)
    expect(b).toMatchObject({ shortName: 'ОФЗ 1', boardId: 'TQOB', face: R(1000), price: 96.5, accrued: R(5.5), matDate: '2036-10-15' })
    expect(b.coupons).toHaveLength(130)
    expect(b.coupons.at(-1)!.value).toBeNull()
    expect(b.redemptions.map(r => r.kind)).toEqual(['amortization', 'maturity'])
  })
})

const bond: Bond = {
  secid: 'SU1', isin: 'RU1', shortName: 'ОФЗ 1', boardId: 'TQOB', face: R(1000), price: 98, accrued: R(10), matDate: '2027-06-15', updatedAt: 0,
  coupons: [
    { date: '2026-10-15', recordDate: '2026-10-14', value: R(40) },
    { date: '2027-01-15', recordDate: '2027-01-14', value: R(40) },
    { date: '2027-04-15', recordDate: '2027-04-14', value: null },
  ],
  redemptions: [{ date: '2027-06-15', value: R(1000), kind: 'maturity' }],
}
const buy = (p: Partial<Trade>): Trade => ({ accountId: 9, secid: 'SU1', date: '2026-10-01', type: 'buy', qty: 10, price: 97, nkd: R(50), fee: R(5), amount: R(9755), ...p })

describe('позиции', () => {
  const trades = [buy({}), buy({ date: '2026-10-14', qty: 5, amount: R(4900) }), buy({ type: 'sell', date: '2026-12-01', qty: 3, amount: R(2950), price: 98 })]

  it('количество на дату', () => {
    expect(qtyAt(trades, 9, 'SU1', '2026-10-13')).toBe(10)
    expect(qtyAt(trades, 9, 'SU1', '2026-10-14')).toBe(15)
    expect(qtyAt(trades, 9, 'SU1', '2026-12-31')).toBe(12)
  })

  it('стоимость, вложено, купоны, доход', () => {
    const coupon: Tx = { date: '2026-10-15', type: 'income', incomeKind: 'interest', accountId: 9, amount: R(522), rub: R(522), comment: '', createdAt: 0, secid: 'SU1' }
    const [p] = positions(trades, [bond], [coupon], '2026-12-31')
    expect(p.qty).toBe(12)
    expect(p.value).toBe(12 * (R(980) + R(10)))
    expect(p.invested).toBe(R(9755 + 4900 - 2950))
    expect(p.profit).toBe(p.value + R(522) - p.invested)
  })

  it('деньги брокерского счёта: покупки списывают, продажи и погашения зачисляют', () => {
    const acc: Account = { id: 9, name: 'Брокер', currency: 'RUB', openingBalance: R(20000), archived: false, order: 0 }
    expect(balances([acc], [], trades).get(9)).toBe(R(20000 - 9755 - 4900 + 2950))
  })

  it('после погашения позиция закрывается и ничего не стоит', () => {
    const t = [buy({}), { ...buy({}), type: 'redeem' as const, date: '2027-06-15', qty: 10, price: 100, nkd: 0, fee: 0, amount: R(10000), closes: true }]
    const [p] = positions(t, [bond], [], '2027-06-20')
    expect(p.qty).toBe(0)
    expect(p.value).toBe(0)
    expect(p.profit).toBe(R(10000 - 9755))
  })
})

describe('купоны и погашения', () => {
  const trades = [buy({}), buy({ date: '2026-10-14', qty: 5, amount: R(4900) })]
  const none = () => false

  it('купон на руки за вычетом 13%, по количеству на дату фиксации', () => {
    const [c] = bondEvents(trades, [bond], '2026-10-01', '2026-10-31', none)
    expect(c).toMatchObject({ kind: 'coupon', qty: 15, amount: Math.round(15 * R(40) * 0.87), estimated: false })
  })

  it('ИИС без налога; необъявленный купон — по последнему известному; погашение целиком', () => {
    const ev = bondEvents(trades, [bond], '2027-04-01', '2027-06-30', () => true)
    expect(ev.map(e => [e.kind, e.amount, e.estimated])).toEqual([['coupon', 15 * R(40), true], ['redemption', 15 * R(1000), false]])
  })

  it('плашка: только наступившие, без записанных и пропущенных', () => {
    const recorded: Tx = { date: '2026-10-15', type: 'income', incomeKind: 'interest', accountId: 9, amount: 1, rub: 1, comment: '', createdAt: 0, eventKey: '9|SU1|coupon|2026-10-15' }
    expect(pendingBondEvents(trades, [bond], [], [], '2027-01-20', none).map(e => e.date)).toEqual(['2026-10-15', '2027-01-15'])
    expect(pendingBondEvents(trades, [bond], [recorded], [{ key: '9|SU1|coupon|2027-01-15', status: 'dismissed' }], '2027-01-20', none)).toEqual([])
  })
})

describe('сбережения через счета', () => {
  const accs: Account[] = [
    { id: 1, name: 'Карта', currency: 'RUB', openingBalance: 0, archived: false, order: 0 },
    { id: 9, name: 'Брокер', currency: 'RUB', openingBalance: 0, archived: false, order: 1, savings: true },
    { id: 4, name: 'Квартира', currency: 'RUB', openingBalance: 0, archived: false, order: 2, savings: false },
  ]
  const t = (p: Partial<Tx>): Tx => ({ date: '2026-10-05', type: 'transfer', accountId: 1, amount: 0, rub: 0, comment: '', createdAt: 0, ...p })
  it('переводы на сберегательный счёт и купоны на нём — сбережения; копилка под платёж — нет', () => {
    const txs = [
      t({ toAccountId: 9, amount: R(20000), rub: R(20000), toAmount: R(20000), toRub: R(20000) }),
      t({ toAccountId: 4, amount: R(30000), rub: R(30000), toAmount: R(30000), toRub: R(30000) }),
      t({ accountId: 9, toAccountId: 1, amount: R(5000), rub: R(5000), toAmount: R(5000), toRub: R(5000) }),
      t({ type: 'income', incomeKind: 'interest', accountId: 9, amount: R(348), rub: R(348) }),
    ]
    expect(savedInMonth(txs, accs, [], '2026-10')).toBe(R(20000 - 5000 + 348))
  })
})
