import { useState } from 'react'
import { db, saveSettings } from '../db'
import { formatMoney } from '../domain/money'
import { CURRENCIES, type Account, type Currency, type Goal } from '../domain/types'
import { AmountInput, Bar, Chips, CUR_SUFFIX, fromInput, Money, Sheet, toInput, useOnce } from './common'
import { activeAccounts, rateHint, type Data } from './data'

export function Accounts({ data }: { data: Data }) {
  const [editAcc, setEditAcc] = useState<Partial<Account> | null>(null)
  const [editGoal, setEditGoal] = useState<Partial<Goal> | null>(null)
  const accounts = activeAccounts(data.accounts)
  const totalRub = accounts.reduce((s, a) => s + (data.toRub(data.bal.get(a.id!) ?? 0, a.currency) ?? 0), 0)

  return (
    <div className="page">
      <h1>Счета и цели</h1>
      <div className="card">
        <div className="line"><span>Всего в рублях</span><strong><Money v={totalRub} /></strong></div>
        <div className="muted small">{rateHint(data.latestRate)}</div>
      </div>

      {accounts.map(a => {
        const b = data.bal.get(a.id!) ?? 0
        const goals = data.progress.filter(p => p.goal.accountId === a.id)
        return (
          <div className="card" key={a.id}>
            <button className="line plain" onClick={() => setEditAcc(a)}>
              <span>{a.name}{a.id === data.settings.defaultAccountId && <span className="muted small"> · основной</span>}</span>
              <strong className={b < 0 ? 'neg' : ''}><Money v={b} cur={a.currency} /></strong>
            </button>
            {a.currency !== 'RUB' && <div className="muted small right">≈ {formatMoney(data.toRub(b, a.currency) ?? 0)}</div>}
            {goals.map(p => (
              <button className="goal" key={p.goal.id} onClick={() => setEditGoal(p.goal)}>
                <div className="line small">
                  <span>🎯 {p.goal.name}</span>
                  <span>{formatMoney(p.saved, a.currency)} <span className="muted">из {formatMoney(p.goal.target, a.currency)}</span></span>
                </div>
                <Bar value={p.saved} max={p.goal.target} />
              </button>
            ))}
            <button className="link small" onClick={() => setEditGoal({ accountId: a.id })}>+ цель на этом счёте</button>
          </div>
        )
      })}
      <button className="secondary" onClick={() => setEditAcc({ currency: 'RUB' })}>+ Добавить счёт</button>

      {editAcc && <AccountSheet data={data} acc={editAcc} onClose={() => setEditAcc(null)} />}
      {editGoal && <GoalSheet data={data} goal={editGoal} onClose={() => setEditGoal(null)} />}
    </div>
  )
}

function AccountSheet({ data, acc, onClose }: { data: Data; acc: Partial<Account>; onClose: () => void }) {
  const [name, setName] = useState(acc.name ?? '')
  const [currency, setCurrency] = useState<Currency>(acc.currency ?? 'RUB')
  const [opening, setOpening] = useState(toInput(acc.openingBalance))
  const [isDefault, setIsDefault] = useState(acc.id != null && acc.id === data.settings.defaultAccountId)
  const used = acc.id != null && data.txs.some(t => t.accountId === acc.id || t.toAccountId === acc.id)

  const save = useOnce(async () => {
    if (!name.trim()) return
    const id = await db.accounts.put({
      ...(acc as Account), name: name.trim(), currency, openingBalance: fromInput(opening) ?? 0,
      archived: acc.archived ?? false, order: acc.order ?? data.accounts.length,
    })
    if (isDefault) await saveSettings({ defaultAccountId: id })
    onClose()
  })
  const archive = useOnce(async () => {
    if (!confirm('Скрыть счёт? Операции по нему сохранятся.')) return
    await db.accounts.update(acc.id!, { archived: true })
    onClose()
  })

  return (
    <Sheet title={acc.id ? 'Счёт' : 'Новый счёт'} onClose={onClose}>
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Т-Банк, Наличные, Накопительный…" autoFocus={!acc.id} />
      <label className="field-label">Валюта</label>
      {used ? <div>{currency}</div> : <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />}
      <label className="field-label">Начальный баланс</label>
      <AmountInput value={opening} onChange={setOpening} suffix={CUR_SUFFIX[currency]} />
      <p className="hint">Сколько было на счёте на момент начала учёта.</p>
      <label className="check"><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Основной счёт для ввода</label>
      <button className="primary" onClick={save}>Сохранить</button>
      {acc.id && <button className="danger" onClick={archive}>Скрыть счёт</button>}
    </Sheet>
  )
}

function GoalSheet({ data, goal, onClose }: { data: Data; goal: Partial<Goal>; onClose: () => void }) {
  const [name, setName] = useState(goal.name ?? '')
  const [target, setTarget] = useState(toInput(goal.target))
  const [accountId, setAccountId] = useState(goal.accountId!)
  const acc = data.accounts.find(a => a.id === accountId)
  const siblings = data.goals.filter(g => g.accountId === accountId && g.id !== goal.id)

  const save = useOnce(async () => {
    const t = fromInput(target)
    if (!name.trim() || !t) return
    await db.goals.put({
      ...(goal as Goal), name: name.trim(), target: t, accountId,
      priority: goal.priority ?? Math.max(-1, ...data.goals.map(g => g.priority)) + 1,
    })
    onClose()
  })
  const remove = useOnce(async () => {
    if (!confirm('Удалить цель? Деньги на счёте останутся.')) return
    await db.goals.delete(goal.id!)
    onClose()
  })
  const raise = useOnce(async () => {
    const sorted = [...data.goals].sort((a, b) => a.priority - b.priority)
    const i = sorted.findIndex(g => g.id === goal.id)
    if (i <= 0) return
    const [a, b] = [sorted[i - 1], sorted[i]]
    await db.transaction('rw', db.goals, async () => {
      await db.goals.update(a.id!, { priority: b.priority })
      await db.goals.update(b.id!, { priority: a.priority })
    })
    onClose()
  })

  return (
    <Sheet title={goal.id ? 'Цель' : 'Новая цель'} onClose={onClose}>
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Подушка, Отпуск…" autoFocus={!goal.id} />
      <label className="field-label">Сумма цели</label>
      <AmountInput value={target} onChange={setTarget} suffix={acc ? CUR_SUFFIX[acc.currency] : ''} />
      <label className="field-label">Счёт</label>
      <select value={accountId} onChange={e => setAccountId(Number(e.target.value))}>
        {activeAccounts(data.accounts).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
      </select>
      {siblings.length > 0 && <p className="hint">На счёте несколько целей: баланс заполняет их по очереди, сначала более приоритетные.</p>}
      <button className="primary" onClick={save}>Сохранить</button>
      {goal.id && <button className="secondary" onClick={raise}>Поднять приоритет</button>}
      {goal.id && <button className="danger" onClick={remove}>Удалить цель</button>}
    </Sheet>
  )
}
