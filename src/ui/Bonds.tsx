import { useEffect, useState } from 'react'
import { db } from '../db'
import { fetchBond, searchBonds, type Bond, type BondEvent, type BondSearchItem, type Position, type Trade } from '../domain/bonds'
import { formatMoney, todayISO } from '../domain/money'
import { AmountInput, fromInput, Money, Segmented, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'
import { Icon } from './icons'
import { notify } from './undo'

const dmy = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`

/** Список бумаг на счёте — внутри карточки счёта. */
export function BondList({ data, accountId, onOpen }: { data: Data; accountId: number; onOpen: (p: Position) => void }) {
  const list = data.bondPositions.filter(p => p.accountId === accountId && p.qty > 0)
  if (!list.length) return null
  return (
    <div className="bond-list">
      {list.map(p => (
        <button key={p.secid} className="bond-row" onClick={() => onOpen(p)}>
          <span className="body">
            <span className="title">{p.bond?.shortName ?? p.secid}</span>
            <span className="sub">{p.qty} шт.{p.bond?.price != null ? ` · ${p.bond.price.toFixed(2).replace('.', ',')}%` : ''}</span>
          </span>
          <span className="amt">
            <Money v={p.value} round />
            <span className={`sub ${p.profit >= 0 ? 'pos' : 'neg'}`}>{p.profit >= 0 ? '+' : '−'}{formatMoney(Math.round(Math.abs(p.profit) / 100) * 100)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** Добавление облигации: поиск на бирже → покупка. */
export function AddBondSheet({ data, accountId, onClose }: { data: Data; accountId: number; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<BondSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bond, setBond] = useState<Bond | null>(null)

  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return }
    let alive = true
    const t = setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const r = await searchBonds(q.trim())
        if (alive) setResults(r)
      } catch {
        if (alive) setError('Не удалось связаться с биржей — нужен интернет')
      } finally {
        if (alive) setLoading(false)
      }
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  async function pick(item: BondSearchItem) {
    setLoading(true); setError('')
    try {
      const b = await fetchBond(item.secid)
      await db.bonds.put(b)
      setBond(b)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet title={bond ? `Покупка: ${bond.shortName}` : 'Добавить облигацию'} onClose={onClose}>
      {bond ? <TradeForm data={data} accountId={accountId} bond={bond} type="buy" onDone={onClose} /> : (
        <>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Название или ISIN: ОФЗ 26238, RU000A…" />
          {loading && <p className="hint">Ищу на Московской бирже…</p>}
          {error && <p className="error">{error}</p>}
          <div className="card tight" style={{ marginTop: 12 }}>
            {results.map(r => (
              <button key={r.secid} className="row" onClick={() => pick(r)}>
                <span className="body"><span className="title">{r.shortName}</span><span className="sub">{r.isin}</span></span>
                <Icon name="right" size={18} />
              </button>
            ))}
            {!loading && q.trim().length >= 3 && !results.length && !error && <p className="hint">Ничего не нашлось.</p>}
          </div>
          <p className="hint">Данные берутся с Московской биржи: цена, НКД, купоны и даты погашения обновляются сами.</p>
        </>
      )}
    </Sheet>
  )
}

/** Сделка: покупка или продажа. Сумма = количество × номинал × цена% + НКД ± комиссия. */
export function TradeForm({ data, accountId, bond, type, onDone }: { data: Data; accountId: number; bond: Bond; type: 'buy' | 'sell'; onDone: () => void }) {
  const [date, setDate] = useState(todayISO())
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState(bond.price != null ? String(bond.price).replace('.', ',') : '')
  const [nkd, setNkd] = useState(toInput(bond.accrued))
  const [fee, setFee] = useState('')
  const [error, setError] = useState('')
  const owned = data.bondPositions.find(p => p.accountId === accountId && p.secid === bond.secid)?.qty ?? 0

  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const p = Number(price.replace(',', '.')) || 0
  const nkdPer = fromInput(nkd) ?? 0
  const feeK = fromInput(fee) ?? 0
  const body = Math.round(n * bond.face * p / 100)
  const amount = type === 'buy' ? body + n * nkdPer + feeK : body + n * nkdPer - feeK
  const cash = data.bal.get(accountId) ?? 0

  const save = useOnce(async () => {
    if (!n) return setError('Укажи количество')
    if (!p) return setError('Укажи цену')
    if (type === 'sell' && n > owned) return setError(`На счёте только ${owned} шт.`)
    const trade: Trade = { accountId, secid: bond.secid, date, type, qty: n, price: p, nkd: n * nkdPer, fee: feeK, amount }
    await db.bonds.put(bond)
    await db.trades.add(trade)
    notify(type === 'buy' ? 'Покупка записана' : 'Продажа записана')
    onDone()
  })

  return (
    <>
      <div className="row2">
        <div><label className="field-label">Количество, шт.</label><input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} autoFocus placeholder={type === 'sell' ? `до ${owned}` : '10'} /></div>
        <div><label className="field-label">Цена, % номинала</label><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
      </div>
      <div className="row2">
        <div><label className="field-label">НКД за 1 шт.</label><AmountInput value={nkd} onChange={setNkd} suffix="₽" /></div>
        <div><label className="field-label">Комиссия</label><AmountInput value={fee} onChange={setFee} suffix="₽" placeholder="0" /></div>
      </div>
      <label className="field-label">Дата</label>
      <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value || todayISO())} />
      <div className="card" style={{ marginTop: 14 }}>
        <div className="line"><span>{type === 'buy' ? 'Спишется со счёта' : 'Придёт на счёт'}</span><strong className="num"><Money v={amount} /></strong></div>
        <div className="muted small">номинал {formatMoney(bond.face)} · {n} шт. × {String(p || 0).replace('.', ',')}% + НКД {formatMoney(n * nkdPer)}{feeK ? ` ${type === 'buy' ? '+' : '−'} комиссия ${formatMoney(feeK)}` : ''}</div>
        {type === 'buy' && amount > cash && <p className="warn">На счёте сейчас <Money v={cash} />. Сначала запиши перевод денег на этот счёт, иначе баланс уйдёт в минус.</p>}
      </div>
      {error && <p className="error">{error}</p>}
      <button className="save" onClick={save}>{type === 'buy' ? 'Записать покупку' : 'Записать продажу'}</button>
    </>
  )
}

/** Карточка позиции: данные бумаги, доходность, сделки, купить/продать. */
export function PositionSheet({ data, position, onClose }: { data: Data; position: Position; onClose: () => void }) {
  const [mode, setMode] = useState<'info' | 'buy' | 'sell'>('info')
  const p = data.bondPositions.find(x => x.accountId === position.accountId && x.secid === position.secid) ?? position
  const bond = p.bond ?? data.bonds.find(b => b.secid === p.secid)
  const trades = data.trades.filter(t => t.accountId === p.accountId && t.secid === p.secid).sort((a, b) => b.date.localeCompare(a.date))
  const today = todayISO()
  const next = bond?.coupons.find(c => c.date >= today)
  const lastKnown = [...(bond?.coupons ?? [])].reverse().find(c => c.value != null)?.value ?? null
  const perNext = next?.value ?? lastKnown
  const net = (v: number) => (data.taxFree(p.accountId) ? v : Math.round(v * 0.87))

  const remove = useOnce(async (t: Trade) => {
    await db.trades.delete(t.id!)
    notify('Сделка удалена', () => db.trades.put(t).then(() => {}))
  })

  if (bond && mode !== 'info') {
    return (
      <Sheet title={`${mode === 'buy' ? 'Покупка' : 'Продажа'}: ${bond.shortName}`} onClose={onClose}>
        <TradeForm data={data} accountId={p.accountId} bond={bond} type={mode} onDone={() => setMode('info')} />
        <button className="secondary" onClick={() => setMode('info')}>Назад</button>
      </Sheet>
    )
  }

  return (
    <Sheet title={bond?.shortName ?? p.secid} onClose={onClose}>
      <div className="card">
        <div className="line"><span>Стоимость</span><strong className="num"><Money v={p.value} round /></strong></div>
        <div className="line small"><span className="muted">Вложено</span><span className="num"><Money v={p.invested} round /></span></div>
        <div className="line small"><span className="muted">Купоны получено</span><span className="num"><Money v={p.coupons} round /></span></div>
        <div className="line">
          <span>Доход</span>
          <strong className={`num ${p.profit >= 0 ? 'pos' : 'neg'}`}>
            {p.profit >= 0 ? '+' : '−'}<Money v={Math.abs(p.profit)} round />{p.invested > 0 && <span className="small"> ({pct(p.profit / p.invested)})</span>}
          </strong>
        </div>
      </div>
      {bond && (
        <div className="card">
          <div className="line small"><span className="muted">Количество</span><span>{p.qty} шт.</span></div>
          <div className="line small"><span className="muted">Цена</span><span>{bond.price != null ? `${bond.price.toFixed(2).replace('.', ',')}%` : '—'} от {formatMoney(bond.face)}</span></div>
          <div className="line small"><span className="muted">НКД за 1 шт.</span><span><Money v={bond.accrued} /></span></div>
          {next && perNext != null && (
            <div className="line small"><span className="muted">Следующий купон</span><span>{dmy(next.date)} · {next.value == null ? '≈ ' : ''}<Money v={net(perNext * p.qty)} round /> на руки</span></div>
          )}
          {bond.matDate && <div className="line small"><span className="muted">Погашение</span><span>{dmy(bond.matDate)}</span></div>}
          <div className="muted small">ISIN {bond.isin} · обновлено {new Date(bond.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      )}
      <div className="row2">
        <button className="save" style={{ marginTop: 0 }} disabled={!bond} onClick={() => setMode('buy')}>Купить</button>
        <button className="secondary" style={{ marginTop: 0 }} disabled={!bond || p.qty <= 0} onClick={() => setMode('sell')}>Продать</button>
      </div>
      <h3 style={{ margin: '18px 2px 8px' }}>Сделки</h3>
      <div className="card tight">
        {trades.map(t => (
          <div className="row" key={t.id}>
            <span className="body">
              <span className="title">{t.type === 'buy' ? 'Покупка' : t.type === 'sell' ? 'Продажа' : t.closes ? 'Погашение' : 'Амортизация'} · {t.qty} шт.</span>
              <span className="sub">{dmy(t.date)}{t.type !== 'redeem' ? ` · ${String(t.price).replace('.', ',')}%` : ''}</span>
            </span>
            <span className={`amt ${t.type === 'buy' ? '' : 'pos'}`}>{t.type === 'buy' ? '−' : '+'}<Money v={t.amount} /></span>
            <button className="icon-btn" aria-label="Удалить сделку" onClick={() => remove(t)}><Icon name="close" size={16} /></button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

/** «Пришёл купон / погашение — записать?» */
export function BondEventSheet({ data, event, onClose }: { data: Data; event: BondEvent; onClose: () => void }) {
  const [amount, setAmount] = useState(toInput(event.amount))
  const [kind, setKind] = useState<'record' | 'skip'>('record')
  const acc = data.accounts.find(a => a.id === event.accountId)
  const bond = data.bonds.find(b => b.secid === event.secid)
  const final = event.kind === 'redemption' && bond?.redemptions.find(r => r.date === event.date)?.kind === 'maturity'

  const save = useOnce(async () => {
    if (kind === 'skip') {
      await db.bondMarks.put({ key: event.key, status: 'dismissed' })
      onClose()
      return
    }
    const v = fromInput(amount)
    if (!v) return
    if (event.kind === 'coupon') {
      await db.txs.add({
        date: event.date, type: 'income', incomeKind: 'interest', accountId: event.accountId, amount: v, rub: v,
        comment: `Купон ${event.shortName}`, createdAt: Date.now(), secid: event.secid, eventKey: event.key,
      })
    } else {
      await db.trades.add({
        accountId: event.accountId, secid: event.secid, date: event.date, type: 'redeem', qty: event.qty, price: 100, nkd: 0, fee: 0,
        amount: v, eventKey: event.key, closes: final,
      })
    }
    notify('Записано')
    onClose()
  })

  return (
    <Sheet title={event.kind === 'coupon' ? `Купон: ${event.shortName}` : `${final ? 'Погашение' : 'Амортизация'}: ${event.shortName}`} onClose={onClose}>
      <p className="hint">{dmy(event.date)} · {event.qty} шт. · на счёт «{acc?.name}»{event.kind === 'coupon' && !data.taxFree(event.accountId) ? ' · за вычетом 13% налога' : ''}{event.estimated ? ' · сумма купона ещё не объявлена, указана по прошлому' : ''}</p>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'record', label: 'Пришло' }, { value: 'skip', label: 'Не приходило' }]} />
      {kind === 'record' ? (
        <>
          <label className="field-label">Сколько пришло</label>
          <AmountInput value={amount} onChange={setAmount} suffix="₽" big />
          <p className="hint">Если брокер начислил другую сумму — поправь. {event.kind === 'coupon' ? 'Запишется как доход «Проценты» и пойдёт в сбережения.' : 'Деньги вернутся на счёт, бумаги ' + (final ? 'выбудут.' : 'останутся с уменьшенным номиналом.')}</p>
        </>
      ) : <p className="hint">Событие больше не будет предлагаться. Например, если бумагу продали до даты или брокер ещё не начислил — тогда лучше закрыть окно и подождать.</p>}
      <button className="save" onClick={save}>{kind === 'record' ? 'Записать' : 'Пропустить'}</button>
    </Sheet>
  )
}
