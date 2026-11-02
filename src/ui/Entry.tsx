import { useMemo, useState } from 'react'
import { db } from '../db'
import { addStarter, incomeKindFor, starterKey } from '../domain/categories'
import { accountKind, accountsForEntry } from '../domain/calc'
import { amountToInput, evalAmount, formatMoney, hasOperator, parseAmount, todayISO } from '../domain/money'
import { convertToRub, rateFor } from '../domain/rates'
import type { Category, Tx, TxType } from '../domain/types'
import { AccountPicker } from './AccountPicker'
import { AmountInput, CUR_SUFFIX, fromInput, Money, Segmented, Sheet, toInput, useOnce } from './common'
import { activeAccounts, type Data } from './data'
import { CatBadge, Icon } from './icons'
import { applyKey, Keypad } from './Keypad'
import { categoryPath, CategoryPicker } from './Pickers'

/** Режим формы: обычные типы операций и составные — платёж по кредиту (перевод + проценты). */
type Mode = TxType | 'loan'
const MORE: { value: Mode; label: string; hint: string; icon: 'expense' | 'card' | 'sliders' }[] = [
  { value: 'refund', label: 'Возврат покупки', hint: 'Деньги вернули за покупку — уменьшает расход её категории', icon: 'expense' },
  { value: 'loan', label: 'Платёж по кредиту', hint: 'Основной долг — перевод на счёт кредита, проценты — расход', icon: 'card' },
  { value: 'adjust', label: 'Корректировка остатка', hint: 'Подогнать остаток счёта под банк — не доход и не расход', icon: 'sliders' },
]
const MODE_LABEL: Record<Mode, string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', refund: 'Возврат', adjust: 'Корректировка', loan: 'Кредит' }

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return todayISO(d) }
const newGroup = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Название перевода по типам счетов: так видно, что это погашение кредита или выдача долга, а не расход. */
export function transferMeaning(data: Data, fromId?: number | null, toId?: number | null): string {
  const a = data.accounts.find(x => x.id === fromId), b = data.accounts.find(x => x.id === toId)
  if (!a || !b) return 'Перевод между своими счетами'
  const ka = accountKind(a), kb = accountKind(b)
  if (kb === 'credit') return 'Погашение долга — не расход'
  if (ka === 'credit') return 'Получение кредита или займа — не доход'
  if (kb === 'debt') return 'Выдача в долг — не расход'
  if (ka === 'debt') return 'Возврат долга мне — не доход'
  if (kb === 'broker') return 'Пополнение брокерского счёта — не расход'
  if (kb === 'savings') return 'Откладываю в копилку — не расход'
  return 'Перевод между своими счетами — не доход и не расход'
}

/** Категория по ключу стартового справочника; если её нет — добавляется её группа. */
async function starterCategory(data: Data, root: string, sub: string): Promise<number | null> {
  const key = starterKey('expense', root, sub)
  const has = data.categories.find(c => c.key === key)
  if (has) return has.id!
  await addStarter(db, 'expense', [root])
  return (await db.categories.where('key').equals(key).first())?.id ?? null
}

interface Part { categoryId: number | null; amount: string }

/** Быстрый ввод операции; с `tx` — редактирование существующей. */
export function Entry({ data, tx, preset, onSaved }: { data: Data; tx?: Tx; preset?: { type?: TxType; accountId?: number; toAccountId?: number }; onSaved: (tx: Tx) => void }) {
  const active = useMemo(() => activeAccounts(data.accounts), [data.accounts])
  const defaultAcc = data.settings.defaultAccountId ?? null
  const [mode, setMode] = useState<Mode>(tx?.type ?? preset?.type ?? 'expense')
  const type: TxType = mode === 'loan' ? 'transfer' : mode
  // Карты — первыми (основная, затем частые), копилки — после. Для «Куда» в переводе — наоборот.
  const accounts = useMemo(() => accountsForEntry(active, data.txs, defaultAcc, todayISO(), type), [active, data.txs, defaultAcc, type])
  const toAccounts = useMemo(() => [...accounts].sort((a, b) => Number(accountKind(a) === 'card') - Number(accountKind(b) === 'card')), [accounts])
  const credits = useMemo(() => active.filter(a => accountKind(a) === 'credit'), [active])

  const [expr, setExpr] = useState(tx ? amountToInput(Math.abs(tx.amount)) : '')
  const [sign, setSign] = useState<1 | -1>(tx?.type === 'adjust' && tx.amount < 0 ? -1 : 1)
  const [accountId, setAccountId] = useState<number | null>(tx?.accountId ?? preset?.accountId ?? (preset?.toAccountId != null ? accounts.find(a => a.id !== preset.toAccountId)?.id : undefined) ?? defaultAcc ?? accounts[0]?.id ?? null)
  // Последняя категория дохода — по умолчанию для нового дохода.
  const lastIncomeCat = useMemo(() => [...data.txs].reverse().find(t => t.type === 'income' && t.categoryId != null)?.categoryId ?? data.categories.find(c => c.key === starterKey('income', 'Работа', 'Зарплата'))?.id ?? null, [data.txs, data.categories])
  const [categoryId, setCategoryId] = useState<number | null>(tx?.categoryId ?? null)
  const [incomeCat, setIncomeCat] = useState<number | null>(tx?.type === 'income' ? tx.categoryId ?? null : lastIncomeCat)
  const [noCategory, setNoCategory] = useState(!!tx && tx.type === 'expense' && tx.categoryId == null)
  const [toAccountId, setToAccountId] = useState<number | null>(tx?.toAccountId ?? preset?.toAccountId ?? null)
  const [toAmount, setToAmount] = useState(toInput(tx?.toAmount))
  const [fee, setFee] = useState('')
  const [interest, setInterest] = useState('')
  const [refundOf, setRefundOf] = useState<number | null>(tx?.refundOf ?? null)
  const [date, setDate] = useState(tx?.date ?? todayISO())
  const [comment, setComment] = useState(tx?.comment ?? '')
  const [tags, setTags] = useState<string[]>(tx?.tags ?? [])
  const [split, setSplit] = useState<Part[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [incOpen, setIncOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [refundPick, setRefundPick] = useState(false)

  const acc = data.accounts.find(a => a.id === accountId)
  const toAcc = data.accounts.find(a => a.id === toAccountId)
  const isExchange = type === 'transfer' && acc && toAcc && acc.currency !== toAcc.currency
  const minor = evalAmount(expr)
  const original = refundOf != null ? data.txs.find(t => t.id === refundOf) : undefined
  const refunded = (id: number) => data.txs.filter(t => t.type === 'refund' && t.refundOf === id && t.id !== tx?.id).reduce((s, t) => s + t.amount, 0)
  const refundable = original ? original.amount - refunded(original.id!) : 0
  const splitSum = split?.reduce((s, p) => s + (parseAmount(p.amount) ?? 0), 0) ?? 0

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
  function pickCategory(id: number | null) {
    setCategoryId(id)
    setNoCategory(id == null)
    if (tx || id == null) return
    const c = data.categories.find(x => x.id === id)
    const own = c?.accountId ?? data.categories.find(x => x.id === c?.parentId)?.accountId
    if (own != null && active.some(a => a.id === own)) setAccountId(own)
  }
  function repeat(t: Tx) {
    setCategoryId(t.categoryId ?? null)
    setNoCategory(false)
    setExpr(amountToInput(t.amount))
    setComment(t.comment)
    if (accounts.some(a => a.id === t.accountId)) setAccountId(t.accountId)
  }
  function pickRefund(t: Tx) {
    setRefundOf(t.id!)
    setCategoryId(t.categoryId ?? null)
    setAccountId(t.accountId)
    setExpr(amountToInput(t.amount - refunded(t.id!)))
    setRefundPick(false)
  }
  const chooseMode = (m: Mode) => {
    setMode(m); setError(''); setSplit(null)
    if (m === 'loan' && !credits.some(a => a.id === toAccountId)) setToAccountId(credits[0]?.id ?? null)
    if (m === 'refund' && refundOf == null) setRefundPick(true)
  }

  const rubHint = acc && acc.currency !== 'RUB' && minor ? convertToRub(minor, acc.currency, data.latestRate) : null
  const cbrTo = isExchange && minor && data.latestRate
    ? Math.round(((convertToRub(minor, acc!.currency, data.latestRate) ?? 0) / (toAcc!.currency === 'RUB' ? 1 : data.latestRate[toAcc!.currency])))
    : null
  const feeK = fromInput(fee) ?? 0
  const interestK = fromInput(interest) ?? 0

  const save = useOnce(async () => {
    setError('')
    if (!minor) return setError('Введи сумму')
    if (!acc) return setError('Выбери счёт')
    if (mode === 'expense' && !split && categoryId == null && !noCategory) { setCatOpen(true); return }
    if (mode === 'expense' && split) {
      if (split.some(p => p.categoryId == null || !(parseAmount(p.amount) ?? 0))) return setError('У каждой части — категория и сумма')
      if (splitSum !== minor) return setError(`Сумма частей ${formatMoney(splitSum)} не равна общей ${formatMoney(minor)}`)
    }
    if (mode === 'income' && incomeCat == null) { setIncOpen(true); return }
    if (mode === 'transfer' || mode === 'loan') {
      if (!toAcc) return setError(mode === 'loan' ? 'Выбери счёт кредита' : 'Выбери, куда перевод')
      if (toAcc.id === acc.id) return setError('Счета совпадают')
    }
    if (mode === 'loan' && interestK + feeK >= minor) return setError('Проценты и комиссия больше платежа')
    if (mode === 'refund') {
      if (!original) { setRefundPick(true); return }
      if (minor > refundable) return setError(`Вернуть можно не больше ${formatMoney(refundable)}`)
    }
    const principal = mode === 'loan' ? minor - interestK - feeK : minor
    const to = type === 'transfer' ? (isExchange ? fromInput(toAmount) : principal) : null
    if (type === 'transfer' && !to) return setError('Введи, сколько пришло на счёт зачисления')

    setSaving(true)
    try {
      const needsRate = acc.currency !== 'RUB' || (type === 'transfer' && toAcc!.currency !== 'RUB')
      const rate = needsRate ? await rateFor(db, date) : null
      const rubOf = (v: number) => convertToRub(v, acc.currency, rate)
      const rub = rubOf(principal)
      const toRub = type === 'transfer' ? convertToRub(to!, toAcc!.currency, rate) : undefined
      if (rub == null || toRub === null) return setError('Нет курса ЦБ: подключись к интернету один раз, дальше курс сохранится')
      const base = { date, accountId: acc.id!, comment: comment.trim(), createdAt: tx?.createdAt ?? Date.now(), tags: tags.length ? tags : undefined }
      const signed = mode === 'adjust' ? sign : 1
      const record: Tx = {
        ...base, type, amount: principal * signed, rub: rub * signed,
        categoryId: mode === 'expense' ? (split ? null : categoryId) : mode === 'income' ? incomeCat : mode === 'refund' ? original!.categoryId ?? null : null,
        incomeKind: mode === 'income' ? incomeKindFor(data.categories, incomeCat) : undefined,
        toAccountId: type === 'transfer' ? toAcc!.id : undefined,
        toAmount: type === 'transfer' ? to! : undefined,
        toRub: type === 'transfer' ? toRub : undefined,
        refundOf: mode === 'refund' ? original!.id : undefined,
        group: tx?.group,
      }
      if (tx?.id != null) record.id = tx.id
      let saved: Tx = record

      if (mode === 'expense' && split) {
        // Разделённая покупка — несколько расходов с общим идентификатором; сумма частей равна общей.
        const group = newGroup()
        const ids = await db.transaction('rw', db.txs, async () => {
          if (tx?.id != null) await db.txs.delete(tx.id)
          const out: number[] = []
          for (const p of split) {
            const v = parseAmount(p.amount)!
            out.push((await db.txs.add({ ...base, type: 'expense', amount: v, rub: rubOf(v)!, categoryId: p.categoryId, group }))!)
          }
          return out
        })
        saved = { ...record, id: ids[0], group }
      } else if (mode === 'loan' || (mode === 'transfer' && feeK > 0 && !tx)) {
        // Платёж по кредиту: основной долг — перевод; проценты и комиссия — отдельные расходы. Всё связано общим идентификатором.
        const group = newGroup()
        const interestCat = interestK ? await starterCategory(data, 'Банковские расходы', 'Проценты по кредитам') : null
        const feeCat = feeK ? await starterCategory(data, 'Банковские расходы', 'Комиссии за переводы') : null
        await db.transaction('rw', db.txs, async () => {
          record.group = group
          record.id = await db.txs.add({ ...record, toAmount: isExchange ? to! : principal })
          if (interestK) await db.txs.add({ ...base, type: 'expense', amount: interestK, rub: rubOf(interestK)!, categoryId: interestCat, comment: base.comment || 'Проценты по кредиту', group })
          if (feeK) await db.txs.add({ ...base, type: 'expense', amount: feeK, rub: rubOf(feeK)!, categoryId: feeCat, comment: base.comment || 'Комиссия', group })
        })
        saved = record
      } else {
        const id = await db.txs.put(record)
        saved = { ...record, id }
        // Изменился доход — старое распределение больше не соответствует сумме.
        if (tx?.id != null && (tx.type !== 'income' || type !== 'income' || tx.amount !== minor || tx.categoryId !== incomeCat || tx.date !== date)) {
          await db.allocations.where('txId').equals(tx.id).delete()
        }
      }
      if (!tx) {
        setExpr(''); setComment(''); setToAmount(''); setCategoryId(null); setNoCategory(false); setSplit(null); setFee(''); setInterest(''); setRefundOf(null)
      }
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  })

  const typeOptions = [
    { value: 'expense' as const, label: 'Расход' },
    { value: 'income' as const, label: 'Доход' },
    { value: 'transfer' as const, label: 'Перевод' },
    { value: 'more' as const, label: MORE.some(m => m.value === mode) ? MODE_LABEL[mode] : 'Ещё' },
  ]
  const miss = [
    !minor && 'сумму', !acc && 'счёт',
    mode === 'expense' && !split && categoryId == null && !noCategory && 'категорию',
    mode === 'income' && incomeCat == null && 'категорию',
    (mode === 'transfer' || mode === 'loan') && !toAcc && (mode === 'loan' ? 'счёт кредита' : 'куда перевести'),
    mode === 'refund' && !original && 'покупку',
  ].filter(Boolean)

  return (
    <div className="entry">
      <Segmented className="type" value={MORE.some(m => m.value === mode) ? 'more' : (mode as 'expense' | 'income' | 'transfer')}
        onChange={v => (v === 'more' ? setMoreOpen(true) : chooseMode(v))} options={typeOptions} />

      <div className={`amount-display ${mode === 'refund' ? 'income' : type}`} aria-live="polite">
        {mode === 'adjust' && <button type="button" className="all-btn" style={{ alignSelf: 'center', fontSize: '1rem' }} aria-label={sign > 0 ? 'Остаток увеличится. Сменить знак' : 'Остаток уменьшится. Сменить знак'} onClick={() => setSign(s => (s > 0 ? -1 : 1))}>{sign > 0 ? '+' : '−'}</button>}
        <span className="v">{expr || '0'}</span><span className="cur">{acc ? CUR_SUFFIX[acc.currency] : '₽'}</span>
      </div>
      <div className="amount-sub">
        {hasOperator(expr) && minor ? <>= {formatMoney(minor, acc?.currency)}</> : rubHint != null ? <>≈ {formatMoney(rubHint)}</> : ' '}
        {(mode === 'transfer' || mode === 'loan') && acc && (data.bal.get(acc.id!) ?? 0) > 0 && (
          <button type="button" className="all-btn" onClick={() => setExpr(amountToInput(data.bal.get(acc.id!) ?? 0))}>
            Всё: <span className="money">{formatMoney(data.bal.get(acc.id!) ?? 0, acc.currency)}</span>
          </button>
        )}
      </div>

      {mode === 'expense' && !tx && !split && recent.length > 0 && (
        <div className="scroll-row">
          {recent.map(t => (
            <button key={t.id} type="button" className="chip recent" onClick={() => repeat(t)}>
              <Icon name="repeat" size={14} /> {t.comment || data.categories.find(x => x.id === t.categoryId)?.name} · <span className="money">{formatMoney(t.amount)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Любая операция — «Откуда → Куда». */}
      <div className="acc-picks">
        {mode === 'income'
          ? <CategoryPicker data={data} kind="income" value={incomeCat} onPick={setIncomeCat} open={incOpen} setOpen={setIncOpen} label="Категория" />
          : <AccountPicker data={data} accounts={accounts} value={accountId} onChange={setAccountId} label={mode === 'refund' ? 'Куда вернули' : mode === 'transfer' || mode === 'loan' ? 'Откуда' : 'Счёт'} />}
        {mode === 'transfer' && (
          <button type="button" className="swap" aria-label="Поменять счета местами"
            onClick={() => { const a = accountId; setAccountId(toAccountId); setToAccountId(a) }}>⇅</button>
        )}
        {mode === 'expense' && !split && (
          <CategoryPicker data={data} kind="expense" value={categoryId} onPick={pickCategory} open={catOpen} setOpen={setCatOpen} allowNone noneChosen={noCategory} label="Категория" />
        )}
        {mode === 'income' && <AccountPicker data={data} accounts={accounts} value={accountId} onChange={setAccountId} label="Счёт" />}
        {mode === 'transfer' && <AccountPicker data={data} accounts={toAccounts} value={toAccountId} onChange={setToAccountId} label="Куда" exclude={accountId} />}
        {mode === 'loan' && <AccountPicker data={data} accounts={credits} value={toAccountId} onChange={setToAccountId} label="Кредит" exclude={accountId} />}
        {mode === 'refund' && (
          <button type="button" className={original ? 'acc-pick' : 'acc-pick unset'} onClick={() => setRefundPick(true)}>
            {original ? <CatBadge categories={data.categories} c={data.categories.find(c => c.id === original.categoryId)} size={36} /> : <span className="badge tone-transfer" style={{ width: 36, height: 36 }}><Icon name="cart" size={18} /></span>}
            <span className="body"><span className="k">Покупка</span><span className="v">{original ? `${categoryPath(data.categories, original.categoryId) || 'Без категории'} · ${new Date(original.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : 'Выбери покупку'}</span></span>
            {original && <span className="bal"><Money v={original.amount} /></span>}
            <Icon name="right" size={18} />
          </button>
        )}
      </div>

      {mode === 'expense' && !tx?.group && (
        split ? (
          <div className="list">
            {split.map((p, i) => (
              <SplitRow key={i} data={data} part={p} onChange={np => setSplit(s => s!.map((x, j) => (j === i ? np : x)))} onRemove={split.length > 2 ? () => setSplit(s => s!.filter((_, j) => j !== i)) : undefined} />
            ))}
            <div className="row noic" style={{ padding: '0.3rem 0.82rem' }}>
              <span className={`body small ${minor && splitSum !== minor ? 'neg' : 'muted'}`}>
                {!minor ? 'Сначала введи общую сумму' : splitSum === minor ? 'Сумма частей сходится' : `Осталось распределить ${formatMoney(minor - splitSum)}`}
              </span>
              <button className="link" onClick={() => setSplit(s => [...s!, { categoryId: null, amount: minor && splitSum < minor ? amountToInput(minor - splitSum) : '' }])}>+ часть</button>
            </div>
            <button className="row noic" style={{ padding: '0 0.82rem', minHeight: '2.6rem' }} onClick={() => setSplit(null)}><span className="body link">Не разделять</span></button>
          </div>
        ) : !tx && (
          <button className="link" style={{ minHeight: '2.6rem', marginTop: '-0.3rem' }} onClick={() => setSplit([{ categoryId, amount: minor ? amountToInput(minor) : '' }, { categoryId: null, amount: '' }])}>Разделить по категориям</button>
        )
      )}

      {(mode === 'transfer' || mode === 'loan') && (
        <>
          {mode === 'transfer' && <p className="hint" style={{ marginTop: 0 }}>{transferMeaning(data, accountId, toAccountId)}</p>}
          {isExchange && (
            <>
              <label className="field-label">Сколько пришло, {CUR_SUFFIX[toAcc!.currency]}</label>
              <AmountInput value={toAmount} onChange={setToAmount} suffix={CUR_SUFFIX[toAcc!.currency]} />
              {cbrTo != null && <div className="hint">По курсу ЦБ было бы ≈ {formatMoney(cbrTo, toAcc!.currency)}. Разница уйдёт в «Разница курса при обмене».</div>}
            </>
          )}
          {mode === 'loan' && credits.length === 0 && <p className="error">Нет счёта кредита. Добавь его в «Счета» с типом «Кредит / долг».</p>}
          {!tx && (
            <div className="row2" style={{ marginBottom: '0.5rem' }}>
              {mode === 'loan' && <div><label className="field-label" htmlFor="interest">Из них проценты</label><AmountInput value={interest} onChange={setInterest} suffix="₽" placeholder="0" /></div>}
              <div><label className="field-label" htmlFor="fee">Комиссия</label><AmountInput value={fee} onChange={setFee} suffix="₽" placeholder="0" /></div>
            </div>
          )}
          {mode === 'loan' && minor ? <p className="hint">Основной долг <Money v={Math.max(0, minor - interestK - feeK)} /> — перевод, не расход. Проценты{feeK ? ' и комиссия' : ''} — расход «Банковские расходы».</p> : null}
        </>
      )}
      {mode === 'refund' && original && <p className="hint" style={{ marginTop: 0 }}>Уменьшит расход категории в месяце возврата. Можно вернуть до <Money v={refundable} /> {refundable < original.amount && '(часть уже возвращена)'}.</p>}
      {mode === 'adjust' && <p className="hint" style={{ marginTop: 0 }}>Остаток счёта изменится на {sign > 0 ? '+' : '−'}{minor ? formatMoney(minor) : '…'}. Не доход и не расход.</p>}

      <div className="scroll-row">
        <button type="button" className={date === todayISO() ? 'chip on' : 'chip'} onClick={() => setDate(todayISO())}>Сегодня</button>
        <button type="button" className={date === yesterday() ? 'chip on' : 'chip'} onClick={() => setDate(yesterday())}>Вчера</button>
        <label className={date !== todayISO() && date !== yesterday() ? 'chip on date-chip' : 'chip date-chip'}>
          <Icon name="calendar" size={16} />
          {date !== todayISO() && date !== yesterday() ? new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'Дата'}
          <input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value || todayISO())} />
        </label>
        {(data.settings.tags ?? []).map(t => (
          <button key={t} type="button" className={tags.includes(t) ? 'chip on' : 'chip'} aria-pressed={tags.includes(t)}
            onClick={() => setTags(s => (s.includes(t) ? s.filter(x => x !== t) : [...s, t]))}>#{t}</button>
        ))}
      </div>

      <input className="comment" name="comment" autoComplete="off" enterKeyHint="done" value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий (необязательно)" />

      {error ? <div className="error">{error}</div> : <div className="todo" aria-live="polite">{miss.length ? `Осталось указать: ${miss.join(', ').replace(/, ([^,]*)$/, ' и $1')}` : ''}</div>}
      <Keypad onKey={k => setExpr(e => applyKey(e, k))} onSave={save} saving={saving} />

      {moreOpen && (
        <Sheet title="Другие операции" onClose={() => setMoreOpen(false)}>
          <div className="list">
            {MORE.map(m => (
              <button key={m.value} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => { setMoreOpen(false); chooseMode(m.value) }}>
                <span className="menu-ico" style={{ background: 'var(--s3)', color: 'var(--text)' }}><Icon name={m.icon} size={16} /></span>
                <span className="body"><span className="title">{m.label}</span><span className="sub wrap">{m.hint}</span></span>
                {mode === m.value && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
          <p className="hint">Получение кредита, выдача и возврат долга, пополнение вклада и брокерского счёта — это «Перевод» между своими счетами: доходы и расходы они не меняют.</p>
        </Sheet>
      )}
      {refundPick && <RefundPick data={data} onPick={pickRefund} onClose={() => setRefundPick(false)} refunded={refunded} />}
    </div>
  )
}

/** Часть разделённой покупки: категория и сумма. */
function SplitRow({ data, part, onChange, onRemove }: { data: Data; part: Part; onChange: (p: Part) => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="row" style={{ padding: '0.3rem 0.82rem', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CategoryPicker data={data} kind="expense" value={part.categoryId} onPick={id => onChange({ ...part, categoryId: id })} open={open} setOpen={setOpen} label="Часть" />
      </div>
      <div style={{ width: '6.5rem', flex: 'none' }}><AmountInput value={part.amount} onChange={v => onChange({ ...part, amount: v })} suffix="₽" /></div>
      {onRemove && <button className="icon-btn" aria-label="Убрать часть" onClick={onRemove}><Icon name="close" size={14} /></button>}
    </div>
  )
}

/** Выбор покупки для возврата: последние расходы, у которых ещё есть что вернуть. */
function RefundPick({ data, onPick, onClose, refunded }: { data: Data; onPick: (t: Tx) => void; onClose: () => void; refunded: (id: number) => number }) {
  const [q, setQ] = useState('')
  const list = [...data.txs]
    .filter(t => t.type === 'expense' && t.amount - refunded(t.id!) > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .filter(t => !q.trim() || `${categoryPath(data.categories, t.categoryId)} ${t.comment} ${t.amount / 100}`.toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru')))
    .slice(0, 50)
  const label = (c?: Category) => c ? categoryPath(data.categories, c.id) : 'Без категории'
  return (
    <Sheet title="За какую покупку возврат" onClose={onClose}>
      <label className="search"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Категория, комментарий, сумма" aria-label="Поиск покупки" autoComplete="off" /></label>
      <div className="list">
        {list.length === 0 && <p className="hint" style={{ padding: '0.5rem 0.82rem' }}>Покупок не найдено.</p>}
        {list.map(t => {
          const c = data.categories.find(x => x.id === t.categoryId)
          const left = t.amount - refunded(t.id!)
          return (
            <button key={t.id} className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => onPick(t)}>
              <CatBadge categories={data.categories} c={c} />
              <span className="body"><span className="title">{label(c)}</span><span className="sub">{new Date(t.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}{t.comment ? ` · ${t.comment}` : ''}</span></span>
              <span className="amt"><Money v={t.amount} />{left < t.amount && <span className="sub">можно вернуть <Money v={left} /></span>}</span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

