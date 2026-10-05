import { useState } from 'react'
import { db, saveSettings } from '../db'
import { moveAndDeleteAccount } from '../domain/accounts'
import { accountKind, accountRole, monthsUntil } from '../domain/calc'
import type { Position } from '../domain/bonds'
import { AddBondSheet, BondList, PositionSheet } from './Bonds'
import { formatMoney, monthGenitive, monthOf, plural, todayISO } from '../domain/money'
import { ACCOUNT_COLORS, BUCKET_LABEL, CURRENCIES, type Account, type AccountColor, type AccountKind, type Bucket, type Currency } from '../domain/types'
import { AccountBadge, COLOR_LABEL } from './AccountBadge'
import { AmountInput, Bar, Chips, CUR_SUFFIX, fromInput, Money, Sheet, toInput, useOnce } from './common'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from './History'
import { Icon } from './icons'
import { notify } from './undo'

const KIND_LABEL: Record<AccountKind, string> = { card: 'карта', savings: 'копилка', broker: 'облигации' }

export function Accounts({ data, onOpenOps }: { data: Data; onOpenOps: (f: OpsFilter) => void }) {
  const [editAcc, setEditAcc] = useState<Partial<Account> | null>(null)
  const [addBondTo, setAddBondTo] = useState<number | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const accounts = activeAccounts(data.accounts)
  const totalRub = accounts.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const groups: [string, Account[]][] = [
    ['Карты', accounts.filter(a => accountKind(a) === 'card')],
    ['Копилки', accounts.filter(a => accountKind(a) === 'savings')],
    ['Облигации', accounts.filter(a => accountKind(a) === 'broker')],
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
          <div className="section-title"><h3>{title}</h3>{gi === 0 && <span className="muted small">нажми — настройки</span>}</div>
          {list.map(a => {
            const b = data.value.get(a.id!) ?? 0
            const goals = data.progress.filter(p => p.goal.accountId === a.id)
            return (
              <div className="card" key={a.id} style={{ paddingTop: 4, paddingBottom: goals.length ? 10 : 4 }}>
                <div className="row">
                  <button className="row-main" onClick={() => setEditAcc(a)}>
                    <AccountBadge account={a} color={data.colorOf(a)} />
                    <div className="body">
                      <div className="title">{a.name}</div>
                      <div className="sub">{a.currency !== 'RUB' ? `${a.currency} · ` : ''}{a.id === data.settings.defaultAccountId ? 'основной' : KIND_LABEL[accountKind(a)]}{a.showOnHome ? ' · на главной' : ''}</div>
                    </div>
                    <div className={`amt ${b < 0 ? 'neg' : ''}`}>
                      <Money v={b} cur={a.currency} />
                      {a.currency !== 'RUB' && <div className="sub">≈ <Money v={data.toRub(b, a.currency) ?? 0} round /></div>}
                    </div>
                  </button>
                </div>
                {(data.bondValue.get(a.id!) ?? 0) > 0 && (
                  <div className="muted small" style={{ margin: '-4px 0 4px 52px' }}>
                    деньги <Money v={data.bal.get(a.id!) ?? 0} round /> · облигации <Money v={data.bondValue.get(a.id!) ?? 0} round />
                  </div>
                )}
                <BondList data={data} accountId={a.id!} onOpen={setPosition} />
                {goals.map(p => {
                  const plan = data.goalPlans.get(p.goal.id!)
                  return (
                    <button key={p.goal.id} onClick={() => setEditAcc(a)} style={{ display: 'block', width: '100%', padding: '8px 0' }}>
                      <div className="line small" style={{ padding: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="target" size={16} /> {goals.length > 1 ? p.goal.name : 'Цель'}</span>
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
                {/* Облигации — только на брокерских счетах (и на старых счетах, где они уже есть). */}
                {a.currency === 'RUB' && (accountKind(a) === 'broker' || data.trades.some(t => t.accountId === a.id)) && (
                  <button className="link small" style={{ padding: '6px 0' }} onClick={() => setAddBondTo(a.id!)}>+ облигация</button>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <button className="secondary" onClick={() => setEditAcc({ currency: 'RUB' })}>+ Добавить счёт</button>

      {editAcc && <AccountSheet data={data} acc={editAcc} onClose={() => setEditAcc(null)}
        onOpenOps={editAcc.id != null ? () => { setEditAcc(null); onOpenOps({ accountId: editAcc.id }) } : undefined} />}
      {addBondTo != null && <AddBondSheet data={data} accountId={addBondTo} onClose={() => setAddBondTo(null)} />}
      {position && <PositionSheet data={data} position={position} onClose={() => setPosition(null)} />}
    </div>
  )
}

function AccountSheet({ data, acc, onClose, onOpenOps }: { data: Data; acc: Partial<Account>; onClose: () => void; onOpenOps?: () => void }) {
  const [name, setName] = useState(acc.name ?? '')
  const [currency, setCurrency] = useState<Currency>(acc.currency ?? 'RUB')
  // Вводится текущий баланс; начальный подбирается так, чтобы с учётом всех операций получилось именно это.
  const current = acc.id != null ? data.bal.get(acc.id) ?? 0 : 0
  const [now, setNow] = useState(current > 0 ? toInput(current) : '')
  const [isDefault, setIsDefault] = useState(acc.id != null && acc.id === data.settings.defaultAccountId)
  const [kind, setKind] = useState<AccountKind>(acc.id != null ? accountKind(acc as Account) : 'card')
  // null — цвет подбирается сам (по названию банка или следующий по порядку), пока не выбран вручную.
  const [color, setColor] = useState<AccountColor | null>(acc.color ?? null)
  const shownColor = color ?? (acc.id != null ? data.colorOf(acc as Account) : null)
  const [showOnHome, setShowOnHome] = useState(!!acc.showOnHome)
  const [role, setRole] = useState<Bucket>(acc.id != null ? accountRole(acc as Account, data.goals) : 'savings')
  // Копилка = цель: сумма и срок прямо у счёта (одна цель на копилку, называется как счёт).
  const goal = acc.id != null ? data.goals.filter(g => g.accountId === acc.id).sort((a, b) => a.priority - b.priority)[0] : undefined
  const [target, setTarget] = useState(toInput(goal?.target))
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [deleting, setDeleting] = useState(false)
  const thisMonth = monthOf(todayISO())
  const [taxFree, setTaxFree] = useState(!!acc.taxFree)
  const hasBonds = acc.id != null && data.trades.some(t => t.accountId === acc.id)
  const used = acc.id != null && data.txs.some(t => t.accountId === acc.id || t.toAccountId === acc.id)

  const save = useOnce(async () => {
    if (!name.trim()) return
    const id = await db.accounts.put({
      ...(acc as Account), name: name.trim(), currency, openingBalance: fromInput(now) == null && current !== 0
        ? acc.openingBalance ?? 0 // поле очистили при отрицательном балансе — ничего не меняем
        : (acc.openingBalance ?? 0) + ((fromInput(now) ?? 0) - current),
      archived: acc.archived ?? false, order: acc.order ?? data.accounts.length, kind, color: color ?? undefined, showOnHome, taxFree,
      role: kind === 'savings' ? role : undefined, savings: undefined,
    })
    if (isDefault) await saveSettings({ defaultAccountId: id })
    const t = kind !== 'card' ? fromInput(target) : null
    if (t) {
      await db.goals.put({
        ...(goal ?? {}), name: name.trim(), target: t, accountId: id!, deadline: deadline || null,
        priority: goal?.priority ?? Math.max(-1, ...data.goals.map(g => g.priority)) + 1,
      })
    } else if (goal) await db.goals.delete(goal.id!)
    onClose()
  })
  const archive = useOnce(async () => {
    await db.accounts.update(acc.id!, { archived: true })
    onClose()
    notify(`Счёт «${acc.name}» скрыт`, () => db.accounts.update(acc.id!, { archived: false }).then(() => {}))
  })

  return (
    <Sheet title={acc.id ? acc.name ?? 'Счёт' : 'Новый счёт'} onClose={onClose}>
      {onOpenOps && (
        <button className="pill-btn" style={{ marginTop: 0 }} onClick={onOpenOps}><Icon name="list" size={15} /> Операции счёта</button>
      )}
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Т-Банк, Наличные, Накопительный…" autoFocus={!acc.id} />
      <label className="field-label">Валюта</label>
      {used ? <div>{currency}</div> : <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />}
      <label className="field-label">{hasBonds ? 'Свободные деньги на счёте (без облигаций)' : 'Сейчас на счёте'}</label>
      <AmountInput value={now} onChange={setNow} suffix={CUR_SUFFIX[currency]} />
      <p className="hint">
        {acc.id ? 'Если не совпадает с банком — введи реальную сумму, история операций не изменится.' : 'Сколько на счёте прямо сейчас.'}
        {current < 0 && <> Сейчас по операциям: <Money v={current} cur={currency} />.</>}
      </p>
      <label className="field-label">Тип</label>
      <Chips options={[
        { value: 'card' as const, label: 'Карта', icon: 'card' as const },
        { value: 'savings' as const, label: 'Копилка', icon: 'target' as const },
        { value: 'broker' as const, label: 'Облигации', icon: 'percent' as const },
      ]} value={kind} onChange={setKind} />
      <p className="hint">{kind === 'broker'
        ? 'Брокерский счёт: сюда добавляются облигации («+ облигация» в списке счетов). Деньги на него переводишь как обычно.'
        : 'Карты показываются первыми при вводе трат, копилки — после.'}</p>
      <label className="field-label">Цвет</label>
      <div className="color-picker">
        {ACCOUNT_COLORS.map(c => (
          <button key={c} type="button" className={c === shownColor ? `acc-${c} on` : `acc-${c}`} aria-label={COLOR_LABEL[c]} onClick={() => setColor(c)}>
            {c === shownColor && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={showOnHome} onChange={e => setShowOnHome(e.target.checked)} /> Показывать на главной под балансом</label>
      {kind === 'savings' && (
        <>
          <label className="field-label">Роль в 50/30/20</label>
          <Chips options={(['needs', 'wants', 'savings'] as Bucket[]).map(b => ({ value: b, label: BUCKET_LABEL[b] }))} value={role} onChange={setRole} />
          <p className="hint" style={{ marginTop: 6 }}>
            {role === 'needs' ? 'Резерв под обязательное — «Квартплата», «Кредиты». Переводы сюда не уменьшают «нужды».'
              : role === 'wants' ? 'Деньги «для себя» — «Game», «Aristo project». Переводы сюда идут в «желания».'
              : 'Подушка, накопления. Переводы сюда (и проценты на нём) идут в «сбережения».'}
          </p>
        </>
      )}
      {kind === 'broker' && <p className="hint">Брокерский счёт всегда считается сбережениями.</p>}
      {kind !== 'card' && (
        <>
          <label className="field-label">Цель <span className="muted">(необязательно)</span></label>
          <div className="row2">
            <AmountInput value={target} onChange={setTarget} suffix={CUR_SUFFIX[currency]} placeholder="Сумма" />
            <input type="month" value={deadline} min={thisMonth} onChange={e => setDeadline(e.target.value)} aria-label="Срок" />
          </div>
          {(() => {
            const t = fromInput(target)
            if (!t) return <p className="hint">Укажи сумму — копилка станет целью с прогрессом. Срок — по желанию.</p>
            const saved = acc.id != null ? data.value.get(acc.id) ?? 0 : 0
            if (!deadline) return <p className="hint">Без срока цель пополняется по остатку из сбережений.</p>
            const per = Math.ceil(Math.max(0, t - saved) / monthsUntil(thisMonth, deadline))
            return <p className="hint">Откладывать ≈ <strong>{formatMoney(Math.round(per / 100) * 100, currency)}</strong> в месяц до конца {monthGenitive(deadline)}.</p>
          })()}
        </>
      )}
      {(kind === 'broker' || hasBonds) && (
        <label className="check"><input type="checkbox" checked={taxFree} onChange={e => setTaxFree(e.target.checked)} /> Купоны без удержания налога (ИИС)</label>
      )}
      <label className="check"><input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Основной счёт для ввода</label>
      <button className="save" onClick={save}>Сохранить</button>
      {acc.id && <button className="danger" onClick={archive}>Скрыть счёт</button>}
      {acc.id && <button className="danger" onClick={() => setDeleting(true)}>Удалить счёт</button>}
      {deleting && acc.id != null && <DeleteAccountSheet data={data} acc={acc as Account} onClose={() => setDeleting(false)} onDone={onClose} />}
    </Sheet>
  )
}

/** Удаление счёта: операции, деньги и сделки переносятся на выбранный счёт той же валюты. */
function DeleteAccountSheet({ data, acc, onClose, onDone }: { data: Data; acc: Account; onClose: () => void; onDone: () => void }) {
  const targets = data.accounts.filter(a => a.id !== acc.id && !a.archived && a.currency === acc.currency)
  const [toId, setToId] = useState<number | null>(data.settings.defaultAccountId !== acc.id && targets.some(a => a.id === data.settings.defaultAccountId) ? data.settings.defaultAccountId : targets[0]?.id ?? null)
  const ops = data.txs.filter(t => t.accountId === acc.id || t.toAccountId === acc.id).length
  const trades = data.trades.filter(t => t.accountId === acc.id).length
  const balance = data.bal.get(acc.id!) ?? 0
  const empty = ops === 0 && trades === 0 && acc.openingBalance === 0
  const target = targets.find(a => a.id === toId)

  const run = useOnce(async () => {
    if (empty) {
      const goals = data.goals.filter(g => g.accountId === acc.id)
      await db.transaction('rw', db.accounts, db.goals, async () => {
        await db.goals.bulkDelete(goals.map(g => g.id!))
        await db.accounts.delete(acc.id!)
      })
      onDone()
      notify(`Счёт «${acc.name}» удалён`, async () => { await db.accounts.put(acc); await db.goals.bulkPut(goals) })
      return
    }
    if (toId == null) return
    const undo = await moveAndDeleteAccount(db, acc.id!, toId)
    onDone()
    notify(`«${acc.name}» удалён, всё перенесено на «${target?.name}»`, undo)
  })

  return (
    <Sheet title={`Удалить «${acc.name}»`} onClose={onClose}>
      {empty ? <p className="hint">На счёте нет операций — он просто удалится.</p> : (
        <>
          <p className="hint">
            На счёте {ops} {plural(ops, ['операция', 'операции', 'операций'])}{trades ? `, ${trades} сделок с облигациями` : ''} и <Money v={balance} cur={acc.currency} />.
            Всё это перейдёт на выбранный счёт, история сохранится. Переводы между этими двумя счетами исчезнут — они станут переводами «сам себе».
          </p>
          <label className="field-label">Перенести на</label>
          {targets.length ? (
            <select value={toId ?? ''} onChange={e => setToId(Number(e.target.value))}>
              {targets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : <p className="error">Нет другого счёта в {acc.currency} — сначала создай его или просто скрой этот.</p>}
        </>
      )}
      <button className="danger" style={{ background: 'color-mix(in srgb, var(--neg) 14%, transparent)' }} disabled={!empty && toId == null} onClick={run}>
        {empty ? 'Удалить' : `Перенести на «${target?.name ?? '…'}» и удалить`}
      </button>
      <button className="secondary" onClick={onClose}>Отмена</button>
    </Sheet>
  )
}
