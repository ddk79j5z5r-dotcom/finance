import { useState } from 'react'
import { db, saveSettings } from '../db'
import { accountKind, monthsUntil } from '../domain/calc'
import { formatMoney, monthGenitive, monthOf, todayISO } from '../domain/money'
import { ACCOUNT_COLORS, CURRENCIES, type Account, type AccountColor, type AccountKind, type Currency, type Goal } from '../domain/types'
import { AccountBadge, COLOR_LABEL } from './AccountBadge'
import { AmountInput, Bar, Chips, CUR_SUFFIX, fromInput, Money, Sheet, toInput, useOnce } from './common'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from './History'
import { Icon } from './icons'
import { notify } from './undo'

export function Accounts({ data, onOpenOps }: { data: Data; onOpenOps: (f: OpsFilter) => void }) {
  const [editAcc, setEditAcc] = useState<Partial<Account> | null>(null)
  const [editGoal, setEditGoal] = useState<Partial<Goal> | null>(null)
  const accounts = activeAccounts(data.accounts)
  const totalRub = accounts.reduce((s, a) => s + (data.toRub(data.bal.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const groups: [string, Account[]][] = [
    ['Карты', accounts.filter(a => accountKind(a) === 'card')],
    ['Копилки', accounts.filter(a => accountKind(a) === 'savings')],
  ]

  return (
    <div className="page">
      <div className="page-head"><h1>Счета и цели</h1></div>
      <div className="card hero">
        <div className="label"><span>Всего в рублях</span></div>
        <div className="big"><Money v={totalRub} round /></div>
        <div className="muted small">{rateHint(data.latestRate)}</div>
      </div>

      {groups.filter(([, list]) => list.length).map(([title, list], gi) => (
        <div key={title}>
          <div className="section-title"><h3>{title}</h3>{gi === 0 && <span className="muted small">нажми — операции счёта</span>}</div>
          {list.map(a => {
            const b = data.bal.get(a.id!) ?? 0
            const goals = data.progress.filter(p => p.goal.accountId === a.id)
            return (
              <div className="card" key={a.id} style={{ paddingTop: 4, paddingBottom: goals.length ? 10 : 4 }}>
                <div className="row">
                  <button className="row-main" onClick={() => onOpenOps({ accountId: a.id })}>
                    <AccountBadge account={a} color={data.colorOf(a)} />
                    <div className="body">
                      <div className="title">{a.name}</div>
                      <div className="sub">{a.currency !== 'RUB' ? `${a.currency} · ` : ''}{a.id === data.settings.defaultAccountId ? 'основной' : accountKind(a) === 'card' ? 'карта' : 'копилка'}{a.showOnHome ? ' · на главной' : ''}</div>
                    </div>
                    <div className={`amt ${b < 0 ? 'neg' : ''}`}>
                      <Money v={b} cur={a.currency} />
                      {a.currency !== 'RUB' && <div className="sub">≈ <Money v={data.toRub(b, a.currency) ?? 0} round /></div>}
                    </div>
                  </button>
                  <button className="icon-btn" aria-label={`Настроить счёт ${a.name}`} onClick={() => setEditAcc(a)}><Icon name="edit" size={18} /></button>
                </div>
                {goals.map(p => {
                  const plan = data.goalPlans.get(p.goal.id!)
                  return (
                    <button key={p.goal.id} onClick={() => setEditGoal(p.goal)} style={{ display: 'block', width: '100%', padding: '8px 0' }}>
                      <div className="line small" style={{ padding: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="target" size={16} /> {p.goal.name}</span>
                        <span className="num"><Money v={p.saved} cur={a.currency} round /> <span className="muted">из <Money v={p.goal.target} cur={a.currency} round /></span></span>
                      </div>
                      <Bar value={p.saved} max={p.goal.target} color="var(--savings)" />
                      {p.goal.deadline && plan && p.remaining > 0 && (
                        <div className="muted small">
                          к концу {monthGenitive(p.goal.deadline)}: по <Money v={plan.monthly} cur={a.currency} round />/мес
                          {plan.left > 0 ? <> · в этом месяце ещё <Money v={plan.left} cur={a.currency} round /></> : <> · <span className="pos">месяц закрыт</span></>}
                        </div>
                      )}
                      {p.remaining <= 0 && <div className="pos small">собрано ✓</div>}
                    </button>
                  )
                })}
                {accountKind(a) === 'savings' && (
                  <button className="link small" style={{ padding: '6px 0' }} onClick={() => setEditGoal({ accountId: a.id })}>+ цель на этом счёте</button>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <button className="secondary" onClick={() => setEditAcc({ currency: 'RUB' })}>+ Добавить счёт</button>

      {editAcc && <AccountSheet data={data} acc={editAcc} onClose={() => setEditAcc(null)} />}
      {editGoal && <GoalSheet data={data} goal={editGoal} onClose={() => setEditGoal(null)} />}
    </div>
  )
}

function AccountSheet({ data, acc, onClose }: { data: Data; acc: Partial<Account>; onClose: () => void }) {
  const [name, setName] = useState(acc.name ?? '')
  const [currency, setCurrency] = useState<Currency>(acc.currency ?? 'RUB')
  // Вводится текущий баланс; начальный подбирается так, чтобы с учётом всех операций получилось именно это.
  const current = acc.id != null ? data.bal.get(acc.id) ?? 0 : 0
  const [now, setNow] = useState(current > 0 ? toInput(current) : '')
  const [isDefault, setIsDefault] = useState(acc.id != null && acc.id === data.settings.defaultAccountId)
  const [kind, setKind] = useState<AccountKind>(acc.id != null ? accountKind(acc as Account) : 'card')
  const [color, setColor] = useState<AccountColor>(acc.id != null ? data.colorOf(acc as Account) : 'blue')
  const [showOnHome, setShowOnHome] = useState(!!acc.showOnHome)
  const used = acc.id != null && data.txs.some(t => t.accountId === acc.id || t.toAccountId === acc.id)

  const save = useOnce(async () => {
    if (!name.trim()) return
    const id = await db.accounts.put({
      ...(acc as Account), name: name.trim(), currency, openingBalance: fromInput(now) == null && current !== 0
        ? acc.openingBalance ?? 0 // поле очистили при отрицательном балансе — ничего не меняем
        : (acc.openingBalance ?? 0) + ((fromInput(now) ?? 0) - current),
      archived: acc.archived ?? false, order: acc.order ?? data.accounts.length, kind, color, showOnHome,
    })
    if (isDefault) await saveSettings({ defaultAccountId: id })
    onClose()
  })
  const archive = useOnce(async () => {
    await db.accounts.update(acc.id!, { archived: true })
    onClose()
    notify(`Счёт «${acc.name}» скрыт`, () => db.accounts.update(acc.id!, { archived: false }).then(() => {}))
  })

  return (
    <Sheet title={acc.id ? 'Счёт' : 'Новый счёт'} onClose={onClose}>
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Т-Банк, Наличные, Накопительный…" autoFocus={!acc.id} />
      <label className="field-label">Валюта</label>
      {used ? <div>{currency}</div> : <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />}
      <label className="field-label">Сейчас на счёте</label>
      <AmountInput value={now} onChange={setNow} suffix={CUR_SUFFIX[currency]} />
      <p className="hint">
        {acc.id ? 'Если не совпадает с банком — введи реальную сумму, история операций не изменится.' : 'Сколько на счёте прямо сейчас.'}
        {current < 0 && <> Сейчас по операциям: <Money v={current} cur={currency} />.</>}
      </p>
      <label className="field-label">Тип</label>
      <Chips options={[{ value: 'card' as const, label: 'Карта', icon: 'card' as const }, { value: 'savings' as const, label: 'Копилка', icon: 'target' as const }]} value={kind} onChange={setKind} />
      <p className="hint">Карты показываются первыми при вводе трат, копилки — после.</p>
      <label className="field-label">Цвет</label>
      <div className="color-picker">
        {ACCOUNT_COLORS.map(c => (
          <button key={c} type="button" className={c === color ? `acc-${c} on` : `acc-${c}`} aria-label={COLOR_LABEL[c]} onClick={() => setColor(c)}>
            {c === color && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={showOnHome} onChange={e => setShowOnHome(e.target.checked)} /> Показывать на главной под балансом</label>
      <label className="check"><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Основной счёт для ввода</label>
      <button className="save" onClick={save}>Сохранить</button>
      {acc.id && <button className="danger" onClick={archive}>Скрыть счёт</button>}
    </Sheet>
  )
}

function GoalSheet({ data, goal, onClose }: { data: Data; goal: Partial<Goal>; onClose: () => void }) {
  const [name, setName] = useState(goal.name ?? '')
  const [target, setTarget] = useState(toInput(goal.target))
  const [accountId, setAccountId] = useState(goal.accountId!)
  const [deadline, setDeadline] = useState(goal.deadline ?? '')
  const thisMonth = monthOf(todayISO())
  const acc = data.accounts.find(a => a.id === accountId)
  const siblings = data.goals.filter(g => g.accountId === accountId && g.id !== goal.id)

  const save = useOnce(async () => {
    const t = fromInput(target)
    if (!name.trim() || !t) return
    await db.goals.put({
      ...(goal as Goal), name: name.trim(), target: t, accountId, deadline: deadline || null,
      priority: goal.priority ?? Math.max(-1, ...data.goals.map(g => g.priority)) + 1,
    })
    onClose()
  })
  const remove = useOnce(async () => {
    const snapshot = await db.goals.get(goal.id!)
    await db.goals.delete(goal.id!)
    onClose()
    if (snapshot) notify(`Цель «${snapshot.name}» удалена`, () => db.goals.put(snapshot).then(() => {}))
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
      <label className="field-label">Срок <span className="muted">(необязательно)</span></label>
      <div className="row2">
        <input type="month" value={deadline} min={thisMonth} onChange={e => setDeadline(e.target.value)} />
        {deadline ? <button className="secondary" style={{ marginTop: 0 }} onClick={() => setDeadline('')}>Без срока</button> : <span />}
      </div>
      {(() => {
        const t = fromInput(target)
        const saved = data.progress.find(p => p.goal.id === goal.id)?.saved ?? 0
        if (!deadline || !t || !acc) return <p className="hint">Без срока цель пополняется по приоритету из сбережений.</p>
        const per = Math.ceil(Math.max(0, t - saved) / monthsUntil(thisMonth, deadline))
        return <p className="hint">Нужно откладывать ≈ <strong>{formatMoney(Math.round(per / 100) * 100, acc.currency)}</strong> в месяц до конца {monthGenitive(deadline)}. При распределении зарплаты цель получит эту сумму в первую очередь.</p>
      })()}
      <button className="save" onClick={save}>Сохранить</button>
      {goal.id && <button className="secondary" onClick={raise}>Поднять приоритет</button>}
      {goal.id && <button className="danger" onClick={remove}>Удалить цель</button>}
    </Sheet>
  )
}
