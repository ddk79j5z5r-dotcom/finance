import { useMemo, useState } from 'react'
import { db } from '../db'
import { amountToInput, evalAmount, formatMoney, hasOperator, todayISO } from '../domain/money'
import { convertToRub, rateFor } from '../domain/rates'
import { accountKind, accountsForEntry } from '../domain/calc'
import type { IncomeKind, Tx, TxType } from '../domain/types'
import { AmountInput, CUR_SUFFIX, fromInput, Segmented, toInput, useOnce } from './common'
import { activeAccounts, rootCategories, type Data } from './data'
import { Icon } from './icons'
import { applyKey, Keypad } from './Keypad'
import { AccountPicker } from './AccountPicker'
import { CategoryPicker, IncomeKindPicker } from './Pickers'

const TYPES: { value: TxType; label: string }[] = [
  { value: 'expense', label: 'Расход' },
  { value: 'income', label: 'Доход' },
  { value: 'transfer', label: 'Перевод' },
]

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return todayISO(d) }

/** Быстрый ввод операции; с `tx` — редактирование существующей. */
export function Entry({ data, tx, onSaved }: { data: Data; tx?: Tx; onSaved: (tx: Tx) => void }) {
  const active = useMemo(() => activeAccounts(data.accounts), [data.accounts])
  const defaultAcc = data.settings.defaultAccountId ?? null
  const initialCat = tx?.categoryId != null ? data.categories.find(c => c.id === tx.categoryId) : undefined

  const [type, setType] = useState<TxType>(tx?.type ?? 'expense')
  // Карты — первыми (основная, затем частые), копилки — после. Для «Куда» в переводе — наоборот.
  const accounts = useMemo(() => accountsForEntry(active, data.txs, defaultAcc, todayISO(), type), [active, data.txs, defaultAcc, type])
  const toAccounts = useMemo(() => [...accounts].sort((a, b) => Number(accountKind(a) === 'card') - Number(accountKind(b) === 'card')), [accounts])
  const [expr, setExpr] = useState(tx ? amountToInput(tx.amount) : '')
  const [accountId, setAccountId] = useState<number | null>(tx?.accountId ?? defaultAcc ?? accounts[0]?.id ?? null)
  const [rootId, setRootId] = useState<number | null>(initialCat ? (initialCat.parentId ?? initialCat.id!) : null)
  const [subId, setSubId] = useState<number | null>(initialCat?.parentId != null ? initialCat.id! : null)
  const [kind, setKind] = useState<IncomeKind>(tx?.incomeKind ?? 'salary')
  const [toAccountId, setToAccountId] = useState<number | null>(tx?.toAccountId ?? null)
  const [toAmount, setToAmount] = useState(toInput(tx?.toAmount))
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [comment, setComment] = useState(tx?.comment ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [catOpen, setCatOpen] = useState(false)

  const acc = data.accounts.find(a => a.id === accountId)
  const toAcc = data.accounts.find(a => a.id === toAccountId)
  const isExchange = type === 'transfer' && acc && toAcc && acc.currency !== toAcc.currency
  const minor = evalAmount(expr)

  // Частые категории — первыми (по тратам за 90 дней).
  const roots = useMemo(() => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
    const freq = new Map<number, number>()
    for (const t of data.txs) {
      if (t.type !== 'expense' || t.date < since || t.categoryId == null) continue
      const c = data.categories.find(x => x.id === t.categoryId)
      const root = c?.parentId ?? c?.id
      if (root != null) freq.set(root, (freq.get(root) ?? 0) + 1)
    }
    return rootCategories(data.categories).sort((a, b) => (freq.get(b.id!) ?? 0) - (freq.get(a.id!) ?? 0))
  }, [data.txs, data.categories])

  // Недавние траты (разные по категории и комментарию) — повтор в одно касание.
  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out: Tx[] = []
    for (const t of [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
      if (t.type !== 'expense' || t.categoryId == null) continue
      const key = `${t.categoryId}|${t.comment}|${t.amount}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
      if (out.length >= 8) break
    }
    return out
  }, [data.txs])

  /** Счёт, привязанный к категории (у подкатегории — свой или родителя). Только для новых операций. */
  function pickCategory(root: number | null, sub: number | null) {
    setRootId(root)
    setSubId(sub)
    if (tx) return
    const own = data.categories.find(c => c.id === sub)?.accountId ?? data.categories.find(c => c.id === root)?.accountId
    if (own != null && active.some(a => a.id === own)) setAccountId(own)
  }

  function repeat(t: Tx) {
    const c = data.categories.find(x => x.id === t.categoryId)
    setRootId(c?.parentId ?? c?.id ?? null)
    setSubId(c?.parentId != null ? c.id! : null)
    setExpr(amountToInput(t.amount))
    setComment(t.comment)
    if (accounts.some(a => a.id === t.accountId)) setAccountId(t.accountId)
  }

  const rubHint = acc && acc.currency !== 'RUB' && minor ? convertToRub(minor, acc.currency, data.latestRate) : null
  const cbrTo = isExchange && minor && data.latestRate
    ? Math.round(((convertToRub(minor, acc!.currency, data.latestRate) ?? 0) / (toAcc!.currency === 'RUB' ? 1 : data.latestRate[toAcc!.currency])))
    : null

  const save = useOnce(async () => {
    setError('')
    if (!minor) return setError('Введи сумму')
    if (!acc) return setError('Выбери счёт')
    if (type === 'expense' && rootId == null) { setCatOpen(true); return }
    if (type === 'transfer') {
      if (!toAcc) return setError('Выбери, куда перевод')
      if (toAcc.id === acc.id) return setError('Счета совпадают')
    }
    const to = type === 'transfer' ? (isExchange ? fromInput(toAmount) : minor) : null
    if (type === 'transfer' && !to) return setError('Введи, сколько пришло на счёт зачисления')

    setSaving(true)
    try {
      const needsRate = acc.currency !== 'RUB' || (type === 'transfer' && toAcc!.currency !== 'RUB')
      const rate = needsRate ? await rateFor(db, date) : null
      const rub = convertToRub(minor, acc.currency, rate)
      const toRub = type === 'transfer' ? convertToRub(to!, toAcc!.currency, rate) : undefined
      if (rub == null || toRub === null) return setError('Нет курса ЦБ: подключись к интернету один раз, дальше курс сохранится')

      const record: Tx = {
        date, type, accountId: acc.id!, amount: minor, rub, comment: comment.trim(), createdAt: tx?.createdAt ?? Date.now(),
        categoryId: type === 'expense' ? (subId ?? rootId) : null,
        incomeKind: type === 'income' ? kind : undefined,
        toAccountId: type === 'transfer' ? toAcc!.id : undefined,
        toAmount: type === 'transfer' ? to! : undefined,
        toRub: type === 'transfer' ? toRub : undefined,
      }
      if (tx?.id != null) record.id = tx.id
      const id = await db.txs.put(record)
      // Изменился доход — старое распределение больше не соответствует сумме.
      if (tx?.id != null && (tx.type !== 'income' || type !== 'income' || tx.amount !== minor || tx.incomeKind !== kind || tx.date !== date)) {
        await db.allocations.where('txId').equals(tx.id).delete()
      }
      if (!tx) {
        setExpr(''); setComment(''); setToAmount(''); setSubId(null); setRootId(null)
      }
      onSaved({ ...record, id })
    } finally {
      setSaving(false)
    }
  })

  return (
    <div className="entry">
      <Segmented className="type" value={type} onChange={setType} options={TYPES} />

      <div className={`amount-display ${type}`} aria-live="polite">
        <span className="v">{expr || '0'}</span><span className="cur">{acc ? CUR_SUFFIX[acc.currency] : '₽'}</span>
      </div>
      <div className="amount-sub">
        {hasOperator(expr) && minor ? <>= {formatMoney(minor, acc?.currency)}</> : rubHint != null ? <>≈ {formatMoney(rubHint)}</> : ' '}
        {type === 'transfer' && acc && (data.bal.get(acc.id!) ?? 0) > 0 && (
          <button type="button" className="all-btn" onClick={() => setExpr(amountToInput(data.bal.get(acc.id!) ?? 0))}>
            Всё: {formatMoney(data.bal.get(acc.id!) ?? 0, acc.currency)}
          </button>
        )}
      </div>

      {type === 'expense' && !tx && recent.length > 0 && (
        <div className="scroll-row" style={{ marginBottom: 12 }}>
          {recent.map(t => {
            const c = data.categories.find(x => x.id === t.categoryId)
            return (
              <button key={t.id} type="button" className="chip recent" onClick={() => repeat(t)}>
                <Icon name="repeat" size={14} /> {t.comment || c?.name} · {formatMoney(t.amount)}
              </button>
            )
          })}
        </div>
      )}

      {/* Любая операция — «Откуда → Куда». */}
      <div className="acc-picks">
        {type === 'income'
          ? <IncomeKindPicker value={kind} onPick={setKind} />
          : <AccountPicker data={data} accounts={accounts} value={accountId} onChange={setAccountId} label="Откуда" />}
        {type === 'transfer' && (
          <button type="button" className="swap" aria-label="Поменять счета местами"
            onClick={() => { const a = accountId; setAccountId(toAccountId); setToAccountId(a) }}>⇅</button>
        )}
        {type === 'expense' && (
          <CategoryPicker data={data} roots={roots} rootId={rootId} subId={subId} onPick={pickCategory} open={catOpen} setOpen={setCatOpen} />
        )}
        {type === 'income' && <AccountPicker data={data} accounts={accounts} value={accountId} onChange={setAccountId} label="Куда" />}
        {type === 'transfer' && <AccountPicker data={data} accounts={toAccounts} value={toAccountId} onChange={setToAccountId} label="Куда" exclude={accountId} />}
      </div>

      {type === 'transfer' && (
        <>
          {isExchange && (
            <>
              <label className="field-label">Сколько пришло, {CUR_SUFFIX[toAcc!.currency]}</label>
              <AmountInput value={toAmount} onChange={setToAmount} suffix={CUR_SUFFIX[toAcc!.currency]} />
              {cbrTo != null && <div className="hint">По курсу ЦБ было бы ≈ {formatMoney(cbrTo, toAcc!.currency)}. Разница уйдёт в «Разница курса при обмене».</div>}
            </>
          )}
        </>
      )}

      <div className="scroll-row" style={{ marginTop: 14 }}>
        <button type="button" className={date === todayISO() ? 'chip on' : 'chip'} onClick={() => setDate(todayISO())}>Сегодня</button>
        <button type="button" className={date === yesterday() ? 'chip on' : 'chip'} onClick={() => setDate(yesterday())}>Вчера</button>
        <label className={date !== todayISO() && date !== yesterday() ? 'chip on date-chip' : 'chip date-chip'}>
          <Icon name="calendar" size={16} />
          {date !== todayISO() && date !== yesterday() ? new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'Дата'}
          <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value || todayISO())} />
        </label>
      </div>

      <input className="comment" name="comment" autoComplete="off" enterKeyHint="done" value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий (необязательно)" />

      {error && <div className="error">{error}</div>}
      <Keypad onKey={k => setExpr(e => applyKey(e, k))} onSave={save} saving={saving} />
    </div>
  )
}
