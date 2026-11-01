import { useState } from 'react'
import { db } from '../db'
import type { BondEvent } from '../domain/bonds'
import { fxLoss, rootOf, type Envelope, type PlannedEvent } from '../domain/calc'
import { monthOf, todayISO } from '../domain/money'
import { eventStatus, incomeTx, paymentTx } from '../domain/plan'
import { INCOME_LABEL, type Recurring, type Tx } from '../domain/types'
import { AccountDot } from './AccountBadge'
import { AmountInput, Money, Sheet, StatusTag, fromInput, toInput, useOnce, useAmountsHidden } from './common'
import type { Data } from './data'
import { Entry } from './Entry'
import { Badge, categoryIcon, Icon, INCOME_ICON } from './icons'
import { notify } from './undo'

const ICON = 30 // px: значки в строках списков

export const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

/** Название дня для групп: «Сегодня, 31 октября», «Вчера, …», «Пт, 30 октября». */
export function dayTitle(date: string) {
  const today = todayISO()
  const y = new Date(); y.setDate(y.getDate() - 1)
  const d = new Date(date + 'T00:00:00')
  const dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
  if (date === today) return `Сегодня, ${dm}`
  if (date === todayISO(y)) return `Вчера, ${dm}`
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' })
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${dm}`
}

// ---------- Операция ----------

/** Как показать операцию: название слева (категория / вид дохода / счета перевода), подробности второй строкой. */
export function txLook(data: Data, t: Tx) {
  const acc = data.accounts.find(a => a.id === t.accountId)
  const to = data.accounts.find(a => a.id === t.toAccountId)
  if (t.type === 'income') {
    const coupon = t.incomeKind === 'interest' && t.secid
    return { icon: INCOME_ICON[t.incomeKind!], tone: coupon ? 'coupon' as const : 'income' as const, title: INCOME_LABEL[t.incomeKind!], sub: [acc?.name, t.comment].filter(Boolean).join(' · '), acc, to }
  }
  if (t.type === 'transfer') {
    return { icon: 'transfer' as const, tone: 'transfer' as const, title: `${acc?.name ?? '?'} → ${to?.name ?? '?'}`, sub: ['Перевод', t.comment].filter(Boolean).join(' · '), acc, to }
  }
  const c = data.categories.find(x => x.id === t.categoryId)
  const root = rootOf(data.categories, t.categoryId)
  return { icon: categoryIcon(root), tone: undefined, title: c && root && c.id !== root.id ? `${root.name} · ${c.name}` : root?.name ?? 'Без категории', sub: [acc?.name, t.comment].filter(Boolean).join(' · '), acc, to }
}

/** Сумма операции со знаком и смысловым цветом: расход «−», доход «+» зелёным, купон фиолетовым, перевод без знака. */
export function TxAmount({ data, t }: { data: Data; t: Tx }) {
  const acc = data.accounts.find(a => a.id === t.accountId)
  const to = data.accounts.find(a => a.id === t.toAccountId)
  const coupon = t.type === 'income' && t.incomeKind === 'interest' && !!t.secid
  const cls = t.type === 'income' ? (coupon ? 'coupon' : 'pos') : t.type === 'transfer' ? 'muted' : ''
  const loss = fxLoss(t)
  return (
    <span className={`amt ${cls}`}>
      {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}<Money v={t.amount} cur={acc?.currency} />
      {t.type === 'transfer' && to && to.currency !== acc?.currency && <span className="sub">→ <Money v={t.toAmount!} cur={to.currency} /></span>}
      {loss !== 0 && <span className="sub neg">курс {loss > 0 ? '−' : '+'}<Money v={Math.abs(loss)} /></span>}
    </span>
  )
}

export function TxRow({ data, t, onOpen }: { data: Data; t: Tx; onOpen: (t: Tx) => void }) {
  const v = txLook(data, t)
  return (
    <button className="row" onClick={() => onOpen(t)}>
      <Badge icon={v.icon} tone={v.tone} size={ICON} />
      <span className="body">
        <span className="title">{v.title}</span>
        <span className="sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {v.acc && <AccountDot color={data.colorOf(v.acc)} />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.sub}</span>
        </span>
      </span>
      <TxAmount data={data} t={t} />
    </button>
  )
}

/** Детали операции: все сведения, «Изменить» и «Удалить» (с отменой). */
export function TxSheet({ data, tx, onClose }: { data: Data; tx: Tx; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const v = txLook(data, tx)
  const remove = useOnce(async () => {
    const alloc = await db.allocations.where('txId').equals(tx.id!).toArray()
    await db.transaction('rw', db.txs, db.allocations, async () => {
      await db.txs.delete(tx.id!)
      await db.allocations.where('txId').equals(tx.id!).delete()
    })
    onClose()
    notify('Операция удалена', async () => {
      await db.transaction('rw', db.txs, db.allocations, async () => {
        await db.txs.put(tx)
        if (alloc.length) await db.allocations.bulkPut(alloc)
      })
    })
  })
  if (editing) {
    return (
      <Sheet title="Изменить операцию" full onClose={onClose}>
        <Entry data={data} tx={tx} onSaved={() => { onClose(); notify('Сохранено') }} />
      </Sheet>
    )
  }
  return (
    <Sheet title={v.title} onClose={onClose}>
      <div style={{ textAlign: 'center', fontSize: '1.9rem', fontWeight: 700, margin: '0.2rem 0 0.7rem' }}><TxAmount data={data} t={tx} /></div>
      <div className="list">
        <div className="row noic"><span className="body muted">Дата</span><span>{dayTitle(tx.date)}</span></div>
        <div className="row noic"><span className="body muted">{tx.type === 'transfer' ? 'Откуда → куда' : 'Счёт'}</span><span>{tx.type === 'transfer' ? `${v.acc?.name ?? '?'} → ${v.to?.name ?? '?'}` : v.acc?.name}</span></div>
        {tx.type === 'expense' && <div className="row noic"><span className="body muted">Категория</span><span>{v.title}</span></div>}
        {tx.comment && <div className="row noic"><span className="body muted">Комментарий</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '60%' }}>{tx.comment}</span></div>}
        {v.acc && v.acc.currency !== 'RUB' && <div className="row noic"><span className="body muted">В рублях</span><Money v={tx.rub} /></div>}
      </div>
      <div className="btn-row">
        <button className="secondary" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Изменить</button>
        <button className="danger" onClick={remove}>Удалить</button>
      </div>
    </Sheet>
  )
}

// ---------- Плановые события ----------

const evDate = (e: PlannedEvent) => shortDate(e.date)

export function EventRow({ e, data, onOpen }: { e: PlannedEvent; data: Data; onOpen?: (e: PlannedEvent) => void }) {
  const today = todayISO()
  const s = eventStatus(e, data.txs, today, r => data.toRub(r.amount, r.currency) ?? r.amount)
  if (e.kind === 'payment') {
    const r = e.recurring
    const root = rootOf(data.categories, r.categoryId)
    return (
      <button className="row" onClick={() => onOpen?.(e)}>
        <Badge icon={categoryIcon(root)} size={ICON} />
        <span className="body"><span className="title">{r.name}</span><span className="sub">{evDate(e)} · <StatusTag s={s} /></span></span>
        <span className="amt">−<Money v={r.amount} cur={r.currency} /></span>
      </button>
    )
  }
  return (
    <button className="row" onClick={() => onOpen?.(e)}>
      <Badge icon="banknote" tone="income" size={ICON} />
      <span className="body"><span className="title">{e.kind === 'salary' ? 'Зарплата' : 'Аванс'}</span><span className="sub">{evDate(e)} · <StatusTag s={s} /></span></span>
      <span className="amt pos">{e.amount ? <>+<Money v={e.amount} /></> : <span className="sub">сумма не задана</span>}</span>
    </button>
  )
}

export function BondEventRow({ e, onOpen }: { e: BondEvent; onOpen?: (e: BondEvent) => void }) {
  return (
    <button className="row" onClick={() => onOpen?.(e)}>
      <Badge icon="percent" tone="coupon" size={ICON} />
      <span className="body"><span className="title">{e.kind === 'coupon' ? 'Купон' : 'Погашение'} {e.shortName}</span><span className="sub">{shortDate(e.date)} · {e.qty} шт.</span></span>
      <span className="amt coupon">{e.amount != null ? <>{e.estimated ? '≈ ' : ''}+<Money v={e.amount} /></> : <span className="sub">не объявлен</span>}</span>
    </button>
  )
}

/**
 * Детали планового события. Платёж: «Отметить оплату» создаёт одну операцию; после этого кнопки нет,
 * вместо неё — связанная операция (повторное нажатие не создаёт дубль). Выплата: план отдельно от факта.
 */
export function EventSheet({ data, e, onClose, onOpenTx }: { data: Data; e: PlannedEvent; onClose: () => void; onOpenTx: (t: Tx) => void }) {
  const today = todayISO()
  const rubOf = (r: Recurring) => data.toRub(r.amount, r.currency) ?? r.amount
  const s = eventStatus(e, data.txs, today, rubOf)
  const linked = e.kind === 'payment' ? paymentTx(e.recurring, data.txs, monthOf(e.date), rubOf) : incomeTx(e.kind, e.date, data.txs)
  const [paying, setPaying] = useState(false)
  const title = e.kind === 'payment' ? e.recurring.name : e.kind === 'salary' ? 'Зарплата' : 'Аванс'
  // Оплата учитывается в месяце платежа: в этом месяце — сегодняшним днём, в другом — днём платежа.
  if (paying && e.kind === 'payment') return <PaySheet data={data} r={e.recurring} date={monthOf(e.date) === monthOf(today) ? today : e.date} onClose={onClose} />
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        <div className="row noic"><span className="body muted">Дата</span><span>{new Date(e.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></div>
        <div className="row noic"><span className="body muted">Сумма</span>{e.kind === 'payment' ? <Money v={e.recurring.amount} cur={e.recurring.currency} /> : e.amount ? <Money v={e.amount} /> : <span className="muted">не задана</span>}</div>
        <div className="row noic"><span className="body muted">Статус</span><StatusTag s={s} /></div>
        {e.kind === 'payment' && e.recurring.reserveAccountId != null && <div className="row noic"><span className="body muted">Копится на</span><span>{data.accounts.find(a => a.id === e.recurring.reserveAccountId)?.name}</span></div>}
      </div>
      {linked ? (
        <>
          <button className="secondary" onClick={() => { onClose(); onOpenTx(linked) }}>Связанная операция · <Money v={linked.amount} /></button>
          <p className="hint">{e.kind === 'payment' ? 'Платёж отмечен — повторная операция не создаётся.' : 'Поступление записано.'}</p>
        </>
      ) : e.kind === 'payment' ? (
        <button className="save" onClick={() => setPaying(true)}>Отметить оплату</button>
      ) : (
        <p className="hint">Плановое поступление: в расчётах это ещё не деньги. Когда придёт — запиши доход через «+».</p>
      )}
    </Sheet>
  )
}

/** Оплата регулярного платежа: создаёт расход с его категорией и названием (по ним платёж и считается оплаченным). */
export function PaySheet({ data, r, date, onClose }: { data: Data; r: Recurring; date?: string; onClose: () => void }) {
  const accounts = data.accounts.filter(a => !a.archived && a.currency === r.currency)
  const [accountId, setAccountId] = useState(
    accounts.find(a => a.id === r.reserveAccountId)?.id ?? accounts.find(a => a.id === data.settings.defaultAccountId)?.id ?? accounts[0]?.id,
  )
  const [value, setValue] = useState(toInput(r.amount))
  const save = useOnce(async () => {
    const amount = fromInput(value)
    if (!amount || accountId == null) return
    if (paymentTx(r, data.txs, monthOf(date ?? todayISO()), x => data.toRub(x.amount, x.currency) ?? x.amount)) { onClose(); return }
    const rub = r.currency === 'RUB' ? amount : data.toRub(amount, r.currency)
    if (rub == null) return
    await db.txs.add({ date: date ?? todayISO(), type: 'expense', accountId, amount, rub, categoryId: r.categoryId, comment: r.name, createdAt: Date.now() })
    notify('Оплата записана')
    onClose()
  })
  return (
    <Sheet title={`Оплата: ${r.name}`} onClose={onClose}>
      <AmountInput value={value} onChange={setValue} big />
      <label className="field-label">Со счёта</label>
      <select value={accountId ?? ''} onChange={e => setAccountId(Number(e.target.value))}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {accounts.length === 0 && <p className="error">Нет счёта в валюте платежа</p>}
      <button className="save" onClick={save} disabled={accounts.length === 0}>Записать расход</button>
    </Sheet>
  )
}

// ---------- Категория бюджета ----------

/** Категория: факт / лимит, остаток или перерасход с величиной; «без лимита» отличается от «лимит 0 ₽». */
export function CategoryRow({ e, onOpen }: { e: Envelope; onOpen: (e: Envelope) => void }) {
  const hidden = useAmountsHidden()
  const over = e.hasLimit && e.spent > e.limit
  const pct = e.limit > 0 ? Math.min(100, (e.spent / e.limit) * 100) : over ? 100 : 0
  const color = over ? 'var(--neg)' : pct >= 85 ? 'var(--warn)' : 'var(--pos)'
  return (
    <button className="row" onClick={() => onOpen(e)} aria-label={hidden ? `${e.category.name}, суммы скрыты` : undefined}>
      <Badge icon={categoryIcon(e.category)} size={ICON} />
      <span className="body">
        <span className="title">{e.category.name}</span>
        <span className="sub wrap">
          {!e.hasLimit ? 'без лимита'
            : over ? <span className="neg">перерасход <Money v={e.spent - e.limit} /></span>
            : <>осталось <Money v={e.available} /></>}
        </span>
        {e.hasLimit && <span className="bar" style={{ display: 'block' }}><span className="fill" style={{ display: 'block', width: `${pct}%`, background: color }} /></span>}
      </span>
      <span className="amt"><Money v={e.spent} />{e.hasLimit && <span className="sub">из <Money v={e.limit} /></span>}</span>
    </button>
  )
}
