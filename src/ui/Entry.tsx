import { useMemo, useState } from 'react'
import { db } from '../db'
import { formatMoney, todayISO } from '../domain/money'
import { convertToRub, rateFor } from '../domain/rates'
import { INCOME_LABEL, type IncomeKind, type Tx, type TxType } from '../domain/types'
import { AmountInput, Chips, CUR_SUFFIX, fromInput, Segmented, toInput, useOnce } from './common'
import { categoryIcon, INCOME_ICON } from './icons'
import { activeAccounts, childrenOf, rootCategories, type Data } from './data'

const TYPES: { value: TxType; label: string }[] = [
  { value: 'expense', label: 'Расход' },
  { value: 'income', label: 'Доход' },
  { value: 'transfer', label: 'Перевод' },
]
const KINDS = (Object.keys(INCOME_LABEL) as IncomeKind[]).map(k => ({ value: k, label: INCOME_LABEL[k], icon: INCOME_ICON[k] }))

/** Быстрый ввод операции; с `tx` — редактирование существующей. */
export function Entry({ data, tx, onSaved }: { data: Data; tx?: Tx; onSaved: (tx: Tx) => void }) {
  const accounts = activeAccounts(data.accounts)
  const defaultAcc = data.settings.defaultAccountId ?? accounts[0]?.id ?? null
  const initialCat = tx?.categoryId != null ? data.categories.find(c => c.id === tx.categoryId) : undefined

  const [type, setType] = useState<TxType>(tx?.type ?? 'expense')
  const [amount, setAmount] = useState(toInput(tx?.amount))
  const [accountId, setAccountId] = useState<number | null>(tx?.accountId ?? defaultAcc)
  const [rootId, setRootId] = useState<number | null>(initialCat ? (initialCat.parentId ?? initialCat.id!) : null)
  const [subId, setSubId] = useState<number | null>(initialCat?.parentId != null ? initialCat.id! : null)
  const [kind, setKind] = useState<IncomeKind>(tx?.incomeKind ?? 'salary')
  const [toAccountId, setToAccountId] = useState<number | null>(tx?.toAccountId ?? null)
  const [toAmount, setToAmount] = useState(toInput(tx?.toAmount))
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [comment, setComment] = useState(tx?.comment ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const acc = data.accounts.find(a => a.id === accountId)
  const toAcc = data.accounts.find(a => a.id === toAccountId)
  const isExchange = type === 'transfer' && acc && toAcc && acc.currency !== toAcc.currency
  const minor = fromInput(amount)

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
  const subs = rootId != null ? childrenOf(data.categories, rootId) : []

  const rubHint = acc && acc.currency !== 'RUB' && minor ? convertToRub(minor, acc.currency, data.latestRate) : null
  const cbrTo = isExchange && minor && data.latestRate
    ? Math.round(((convertToRub(minor, acc!.currency, data.latestRate) ?? 0) / (toAcc!.currency === 'RUB' ? 1 : data.latestRate[toAcc!.currency])))
    : null

  const save = useOnce(async () => {
    setError('')
    if (!minor) return setError('Введи сумму')
    if (!acc) return setError('Выбери счёт')
    if (type === 'expense' && rootId == null) return setError('Выбери категорию')
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
        setAmount(''); setComment(''); setToAmount(''); setSubId(null); setRootId(null)
      }
      onSaved({ ...record, id })
    } finally {
      setSaving(false)
    }
  })

  const accOptions = accounts.map(a => ({ value: a.id!, label: `${a.name} ${CUR_SUFFIX[a.currency]}`, icon: 'wallet' as const }))

  return (
    <div className="entry">
      <Segmented className="type" value={type} onChange={setType} options={TYPES} />

      <AmountInput value={amount} onChange={setAmount} big autoFocus={!tx} tone={type} suffix={acc ? CUR_SUFFIX[acc.currency] : ''} />
      {rubHint != null && <div className="hint center">≈ {formatMoney(rubHint)}</div>}

      <label className="field-label">{type === 'transfer' ? 'Откуда' : 'Счёт'}</label>
      <Chips options={accOptions} value={accountId} onChange={setAccountId} />

      {type === 'expense' && (
        <>
          <label className="field-label">Категория</label>
          <Chips options={roots.map(c => ({ value: c.id!, label: c.name, icon: categoryIcon(c) }))} value={rootId} onChange={v => { setRootId(v); setSubId(null) }} />
          {subs.length > 0 && (
            <>
              <label className="field-label">Подкатегория <span className="muted">(необязательно)</span></label>
              <Chips options={subs.map(c => ({ value: c.id!, label: c.name }))} value={subId} onChange={v => setSubId(v === subId ? null : v)} />
            </>
          )}
        </>
      )}

      {type === 'income' && (
        <>
          <label className="field-label">Что за доход</label>
          <Chips options={KINDS} value={kind} onChange={setKind} />
        </>
      )}

      {type === 'transfer' && (
        <>
          <label className="field-label">Куда</label>
          <Chips options={accOptions.filter(o => o.value !== accountId)} value={toAccountId} onChange={setToAccountId} />
          {isExchange && (
            <>
              <label className="field-label">Сколько пришло, {CUR_SUFFIX[toAcc!.currency]}</label>
              <AmountInput value={toAmount} onChange={setToAmount} suffix={CUR_SUFFIX[toAcc!.currency]} />
              {cbrTo != null && <div className="hint">По курсу ЦБ было бы ≈ {formatMoney(cbrTo, toAcc!.currency)}. Разница уйдёт в «Разница курса при обмене».</div>}
            </>
          )}
        </>
      )}

      <div className="row2">
        <div>
          <label className="field-label">Дата</label>
          <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value || todayISO())} />
        </div>
        <div>
          <label className="field-label">Комментарий</label>
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="—" />
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      <button className="save" disabled={saving} onClick={save}>Сохранить</button>
    </div>
  )
}
