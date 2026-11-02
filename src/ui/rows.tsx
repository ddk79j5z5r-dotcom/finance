import { useState } from 'react'
import { db } from '../db'
import type { BondEvent } from '../domain/bonds'
import { eventTitle, fxLoss, type Envelope, type GoalProgress, type PlannedEvent } from '../domain/calc'
import { extraTx } from '../domain/pay'
import { monthOf, todayISO } from '../domain/money'
import { eventStatus, incomeTx, paymentTx } from '../domain/plan'
import { INCOME_LABEL, type Category, type Recurring, type Tx } from '../domain/types'
import { AccountBadge } from './AccountBadge'
import { Money, Sheet, StatusTag, useOnce, useAmountsHidden } from './common'
import type { Data } from './data'
import { Entry, transferMeaning } from './Entry'
import { Badge, CatBadge, categoryIcon, categoryLook, Icon, INCOME_ICON } from './icons'
import { categoryPath } from './Pickers'
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

/** Как показать операцию: название слева (категория / вид дохода / смысл перевода), подробности второй строкой. */
export function txLook(data: Data, t: Tx) {
  const acc = data.accounts.find(a => a.id === t.accountId)
  const to = data.accounts.find(a => a.id === t.toAccountId)
  const c = data.categories.find(x => x.id === t.categoryId)
  const tags = (t.tags ?? []).map(x => `#${x}`)
  const parent = c?.parentId != null ? data.categories.find(x => x.id === c.parentId) : undefined
  // Название — то, что человек помнит (комментарий или подкатегория); ниже — категория и счёт.
  const named = (fallback: string, prefix = '') => t.comment
    ? { title: prefix + t.comment, sub: [(parent ?? c)?.name ?? fallback, acc?.name, ...tags].filter(Boolean).join(' · ') }
    : { title: prefix + (c?.name ?? fallback), sub: [parent?.name, acc?.name, ...tags].filter(Boolean).join(' · ') }
  if (t.type === 'income') {
    const coupon = t.incomeKind === 'interest' && t.secid
    if (c && !coupon) { const l = categoryLook(data.categories, c); return { icon: l.icon, color: l.color, tone: 'income' as const, ...named(''), acc, to } }
    return { icon: INCOME_ICON[t.incomeKind ?? 'other'], color: undefined, tone: coupon ? 'coupon' as const : 'income' as const, title: t.comment || INCOME_LABEL[t.incomeKind ?? 'other'], sub: [t.comment ? INCOME_LABEL[t.incomeKind ?? 'other'] : '', acc?.name, ...tags].filter(Boolean).join(' · '), acc, to }
  }
  if (t.type === 'transfer') {
    const meaning = transferMeaning(data, t.accountId, t.toAccountId).split(' — ')[0]
    return { icon: 'transfer' as const, color: undefined, tone: 'transfer' as const, title: t.comment || `${acc?.name ?? '?'} → ${to?.name ?? '?'}`, sub: [t.comment ? `${acc?.name ?? '?'} → ${to?.name ?? '?'}` : meaning, ...tags].filter(Boolean).join(' · '), acc, to }
  }
  if (t.type === 'adjust') return { icon: 'sliders' as const, color: undefined, tone: 'transfer' as const, title: 'Корректировка остатка', sub: [acc?.name, t.comment, ...tags].filter(Boolean).join(' · '), acc, to }
  const l = categoryLook(data.categories, c)
  if (t.type === 'refund') return { icon: l.icon, color: l.color, tone: undefined, ...named('Без категории', 'Возврат: '), acc, to }
  const v = named('Без категории')
  return { icon: l.icon, color: c ? l.color : undefined, tone: undefined, title: v.title, sub: t.group ? `Часть покупки · ${v.sub}` : v.sub, acc, to }
}

/** Время записи — если операция записана в тот же день (для импортированных и прошлых дат не показываем). */
export function txTime(t: Tx) {
  const d = new Date(t.createdAt)
  return todayISO(d) === t.date ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
}

/** Сумма операции со знаком и смысловым цветом: расход «−», доход и возврат «+» зелёным, купон фиолетовым, перевод без знака. */
export function TxAmount({ data, t }: { data: Data; t: Tx }) {
  const acc = data.accounts.find(a => a.id === t.accountId)
  const to = data.accounts.find(a => a.id === t.toAccountId)
  const coupon = t.type === 'income' && t.incomeKind === 'interest' && !!t.secid
  const cls = t.type === 'income' || t.type === 'refund' ? (coupon ? 'coupon' : 'pos') : t.type === 'transfer' || t.type === 'adjust' ? 'muted' : ''
  const loss = fxLoss(t)
  const sign = t.type === 'expense' ? '−' : t.type === 'income' || t.type === 'refund' ? '+' : t.type === 'adjust' ? (t.amount < 0 ? '−' : '+') : ''
  return (
    <span className={`amt ${cls}`}>
      {sign}<Money v={Math.abs(t.amount)} cur={acc?.currency} />
      {t.type === 'transfer' && to && to.currency !== acc?.currency && <span className="sub">→ <Money v={t.toAmount!} cur={to.currency} /></span>}
      {loss !== 0 && <span className="sub neg">курс {loss > 0 ? '−' : '+'}<Money v={Math.abs(loss)} /></span>}
    </span>
  )
}

export function TxRow({ data, t, onOpen }: { data: Data; t: Tx; onOpen: (t: Tx) => void }) {
  const v = txLook(data, t)
  const time = txTime(t)
  return (
    <button className="row tx-row" onClick={() => onOpen(t)}>
      <Badge icon={v.icon} tone={v.tone} color={v.color} size={ICON} />
      <span className="body">
        <span className="title">{v.title}</span>
        <span className="sub">{v.sub}</span>
      </span>
      <span className="tx-right"><TxAmount data={data} t={t} />{time && <span className="time">{time}</span>}</span>
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
      <Sheet title="Изменить операцию" full cancel onClose={onClose}>
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
        {(tx.type === 'expense' || tx.type === 'refund' || tx.type === 'income') && <div className="row noic"><span className="body muted">Категория</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '60%' }}>{categoryPath(data.categories, tx.categoryId) || 'Без категории'}</span></div>}
        {tx.type === 'transfer' && <div className="row noic"><span className="body muted">Смысл</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '65%' }}>{transferMeaning(data, tx.accountId, tx.toAccountId)}</span></div>}
        {tx.type === 'refund' && <div className="row noic"><span className="body muted">Учёт</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '65%' }}>Уменьшает расход категории в месяце возврата</span></div>}
        {tx.group && <div className="row noic"><span className="body muted">Связано</span><span>{data.txs.filter(x => x.group === tx.group).length} операции вместе</span></div>}
        {!!tx.tags?.length && <div className="row noic"><span className="body muted">Метки</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '65%' }}>{tx.tags.map(x => `#${x}`).join(' ')}</span></div>}
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

// ---------- Цель ----------

/** Доля накопленного: при очень малой сумме — «<1%», а не ноль, и шкала не пустая. */
export function goalPct(saved: number, target: number) {
  if (target <= 0) return { pct: 0, label: '—', width: 0 }
  const raw = (saved / target) * 100
  const pct = Math.min(100, Math.floor(raw))
  return { pct, label: saved > 0 && raw < 1 ? '<1%' : `${pct}%`, width: saved > 0 ? Math.max(raw, 1.5) : 0 }
}

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
/** «до декабря 2030 г.» */
export const monthYear = (ym: string) => `${MONTH_GEN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)} г.`

/** Строка цели: значок копилки, название, накоплено из цели, шкала и процент. */
export function GoalRow({ data, p, onOpen }: { data: Data; p: GoalProgress; onOpen: () => void }) {
  const a = data.accounts.find(x => x.id === p.goal.accountId)
  const g = goalPct(p.saved, p.goal.target)
  return (
    <button className="row goal-row" onClick={onOpen}>
      {a ? <AccountBadge account={a} color={data.colorOf(a)} size={ICON} /> : <Badge icon="target" size={ICON} />}
      <span className="body">
        <span className="title">{p.goal.name}</span>
        <span className="goal-amt"><Money v={p.saved} cur={a?.currency} whole /> <span className="muted">из <Money v={p.goal.target} cur={a?.currency} whole /></span></span>
        <span className="goal-line"><span className="bar"><span className="fill" style={{ display: 'block', width: `${Math.min(100, g.width)}%` }} /></span><span className="pct">{g.label}</span></span>
        {p.goal.deadline && <span className="sub">до {monthYear(p.goal.deadline)}</span>}
      </span>
    </button>
  )
}

// ---------- Плановые события ----------

const evDate = (e: PlannedEvent) => shortDate(e.date)

const FUND: Record<Recurring['fundFrom'], string> = { salary: 'из зарплаты', advance: 'из аванса', both: 'из зарплаты и аванса' }

/** Плановое событие: название, дата и источник денег слева; сумма и статус справа. */
export function EventRow({ e, data, onOpen }: { e: PlannedEvent; data: Data; onOpen?: (e: PlannedEvent) => void }) {
  const today = todayISO()
  const s = eventStatus(e, data.txs, today, r => data.toRub(r.amount, r.currency) ?? r.amount)
  if (e.kind === 'payment') {
    const r = e.recurring
    const reserve = r.reserveAccountId != null ? data.accounts.find(a => a.id === r.reserveAccountId)?.name : undefined
    return (
      <button className="row ev-row" onClick={() => onOpen?.(e)}>
        <CatBadge categories={data.categories} c={data.categories.find(c => c.id === r.categoryId)} size={ICON} />
        <span className="body"><span className="title">{r.name}</span><span className="sub">{evDate(e)} · {reserve ? `резерв «${reserve}»` : FUND[r.fundFrom]}</span></span>
        <span className="tx-right"><span className="amt">−<Money v={r.amount} cur={r.currency} /></span><StatusTag s={s} /></span>
      </button>
    )
  }
  return (
    <button className="row ev-row" onClick={() => onOpen?.(e)}>
      <Badge icon={e.kind === 'extra' && e.premium ? 'star' : 'banknote'} tone="income" size={ICON} />
      <span className="body"><span className="title">{eventTitle(e)}</span><span className="sub">{evDate(e)}{e.kind === 'extra' ? ` · ${e.detail}` : ''}</span></span>
      <span className="tx-right"><span className="amt pos">{e.amount ? <>+<Money v={e.amount} /></> : <span className="sub">сумма не задана</span>}</span><StatusTag s={s} income /></span>
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
/** Отметить платёж оплаченным в месяце (или снять отметку) — без записи расхода; с отменой. */
export async function markPaid(id: number, month: string, paid: boolean) {
  const r = await db.recurring.get(id)
  if (!r) return
  const months = new Set(r.paidMonths ?? [])
  if (paid) months.add(month); else months.delete(month)
  await db.recurring.update(id, { paidMonths: [...months].sort() })
  notify(paid ? `«${r.name}» оплачено` : 'Отметка снята', async () => { await db.recurring.update(id, { paidMonths: r.paidMonths ?? [] }) })
}

/** Обязательный платёж с отметкой «оплачено» справа: касание круга — отметить или снять, строки — подробности. */
export function PaymentRow({ e, data, onOpen }: { e: Extract<PlannedEvent, { kind: 'payment' }>; data: Data; onOpen: (e: PlannedEvent) => void }) {
  const r = e.recurring
  const month = monthOf(e.date)
  const s = eventStatus(e, data.txs, todayISO(), x => data.toRub(x.amount, x.currency) ?? x.amount)
  const marked = !!r.paidMonths?.includes(month)
  const paid = s === 'done'
  const byTx = paid && !marked // оплата найдена по операции — снимать нечего
  return (
    <div className={paid ? 'row pay-row paid' : 'row pay-row'}>
      <button className="row-main" onClick={() => onOpen(e)}>
        <CatBadge categories={data.categories} c={data.categories.find(c => c.id === r.categoryId)} size={ICON} />
        <span className="body">
          <span className="title">{r.name}</span>
          <span className="sub">{evDate(e)}{s === 'late' ? <> · <span className="neg">просрочено</span></> : paid ? ' · оплачено' : ''}</span>
        </span>
        <span className="amt"><Money v={r.amount} cur={r.currency} whole /></span>
      </button>
      <button className={paid ? 'pay-check on' : 'pay-check'} disabled={byTx} aria-pressed={paid}
        aria-label={paid ? (byTx ? `${r.name}: оплачено по операции` : `${r.name}: оплачено. Снять отметку`) : `Отметить «${r.name}» оплаченным`}
        onClick={() => markPaid(r.id!, month, !paid)}>
        {paid && <Icon name="check" size={15} stroke={3} />}
      </button>
    </div>
  )
}

export function EventSheet({ data, e, onClose, onOpenTx }: { data: Data; e: PlannedEvent; onClose: () => void; onOpenTx: (t: Tx) => void }) {
  const today = todayISO()
  const rubOf = (r: Recurring) => data.toRub(r.amount, r.currency) ?? r.amount
  const s = eventStatus(e, data.txs, today, rubOf)
  const month = monthOf(e.date)
  const marked = e.kind === 'payment' && !!e.recurring.paidMonths?.includes(month)
  const linked = e.kind === 'payment' ? (marked ? undefined : paymentTx(e.recurring, data.txs, month, rubOf)) : e.kind === 'extra' ? extraTx(e, data.txs) : incomeTx(e.kind, e.date, data.txs)
  const title = eventTitle(e)
  // Отметка — без операции: деньги со счетов не списываются, платёж просто считается оплаченным в этом месяце.
  const setPaid = useOnce(async (paid: boolean) => {
    if (e.kind !== 'payment') return
    onClose()
    await markPaid(e.recurring.id!, month, paid)
  })
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        <div className="row noic"><span className="body muted">Дата</span><span>{new Date(e.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></div>
        <div className="row noic"><span className="body muted">Сумма</span>{e.kind === 'payment' ? <Money v={e.recurring.amount} cur={e.recurring.currency} /> : e.amount ? <Money v={e.amount} /> : <span className="muted">не задана</span>}</div>
        <div className="row noic"><span className="body muted">Статус</span><StatusTag s={s} income={e.kind !== 'payment'} /></div>
        {e.kind === 'extra' && <div className="row noic"><span className="body muted">Расчёт</span><span className="title wrap" style={{ textAlign: 'right', maxWidth: '65%' }}>{e.detail}</span></div>}
        {e.kind === 'payment' && e.recurring.reserveAccountId != null && <div className="row noic"><span className="body muted">Копится на</span><span>{data.accounts.find(a => a.id === e.recurring.reserveAccountId)?.name}</span></div>}
      </div>
      {e.kind === 'payment' ? (
        marked ? (
          <>
            <div className="paid-banner"><span className="paid-check"><Icon name="check" size={16} stroke={3} /></span><span><b>Оплачено</b><span>Отмечено вручную — со счетов ничего не списывалось</span></span></div>
            <button className="link unmark" onClick={() => setPaid(false)}>Снять отметку</button>
          </>
        ) : linked ? (
          <>
            <div className="paid-banner"><span className="paid-check"><Icon name="check" size={16} stroke={3} /></span><span><b>Оплачено</b><span>Оплата найдена среди операций</span></span></div>
            <button className="secondary" onClick={() => { onClose(); onOpenTx(linked) }}>Связанная операция · <Money v={linked.amount} /></button>
          </>
        ) : (
          <>
            <button className="save" onClick={() => setPaid(true)}>Отметить оплату</button>
            <p className="hint">Только отметка: со счетов ничего не списывается.</p>
          </>
        )
      ) : linked ? (
        <>
          <button className="secondary" onClick={() => { onClose(); onOpenTx(linked) }}>Поступление · <Money v={linked.amount} /></button>
          <p className="hint">Поступление записано.</p>
        </>
      ) : (
        <p className="hint">Плановое поступление: в расчётах это ещё не деньги. Когда придёт — запиши доход через «+»{e.kind === 'extra' ? ` с комментарием «${e.name}»${e.premium ? ' или в категории «Премия»' : ''} — тогда выплата отметится полученной` : ''}.</p>
      )}
    </Sheet>
  )
}


// ---------- Категория бюджета ----------

/** Категория: факт / лимит, остаток или перерасход с величиной; «без лимита» отличается от «лимит 0 ₽». */
export function CategoryRow({ e, onOpen, categories, note }: { e: Envelope; onOpen: (e: Envelope) => void; categories?: Category[]; note?: string }) {
  const hidden = useAmountsHidden()
  const over = e.hasLimit && e.spent > e.limit
  const raw = e.limit > 0 ? (e.spent / e.limit) * 100 : over ? 100 : 0
  const tone = over ? 'over' : raw >= 90 ? 'near' : ''
  return (
    <button className="row cat-row" onClick={() => onOpen(e)} aria-label={hidden ? `${e.category.name}, суммы скрыты` : undefined}>
      {categories ? <CatBadge categories={categories} c={e.category} size={ICON} /> : <Badge icon={categoryIcon(e.category)} size={ICON} />}
      <span className="body">
        <span className="goal-line">
          <span className="title">{e.category.name}{e.category.archived && <span className="muted small"> · в архиве</span>}</span>
          <span className={`cat-amt ${over ? 'neg' : ''}`}><Money v={e.spent} whole />{e.hasLimit && <span className="muted"> из <Money v={e.limit} whole /></span>}</span>
        </span>
        {e.hasLimit ? (
          <span className="goal-line">
            <span className={`bar ${tone}`}><span className="fill" style={{ display: 'block', width: `${Math.min(100, raw)}%` }} /></span>
            <span className={`pct ${over ? 'neg' : ''}`}>{e.limit > 0 ? `${Math.round(raw)}%` : 'лимит 0'}</span>
          </span>
        ) : <span className="sub">{note ?? 'без лимита'}</span>}
        {over && <span className="sub neg">перерасход <Money v={e.spent - e.limit} /></span>}
        {e.hasLimit && !over && note && <span className="sub">{note}</span>}
      </span>
    </button>
  )
}
