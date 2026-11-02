import { useState } from 'react'
import { db, saveSettings } from '../db'
import { moveAndDeleteAccount } from '../domain/accounts'
import { accountKind, monthsUntil } from '../domain/calc'
import type { Position } from '../domain/bonds'
import { AddBondSheet, BondList, PositionSheet } from './Bonds'
import { formatMoney, monthGenitive, monthOf, plural, todayISO } from '../domain/money'
import { ACCOUNT_COLORS, CURRENCIES, type Account, type AccountColor, type AccountKind, type Currency } from '../domain/types'
import { AccountBadge, COLOR_LABEL } from './AccountBadge'
import { AmountInput, Chips, CUR_SUFFIX, Empty, fromInput, Money, Section, Segmented, Sheet, toInput, useOnce } from './common'
import { inTotal } from '../domain/plan'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from './History'
import { Icon } from './icons'
import { notify } from './undo'

export type EntryPreset = { type?: 'expense' | 'income' | 'transfer'; accountId?: number; toAccountId?: number }

/** Счета и цели — разные сущности: переключателем. «Инвестиции» — те же счета, только брокерские с облигациями. */
export function Accounts({ data, onOpenOps, onAdd, initialTab = 'accounts' }: {
  data: Data; onOpenOps: (f: OpsFilter) => void; onAdd: (p: EntryPreset) => void; initialTab?: 'accounts' | 'goals' | 'invest'
}) {
  const [tab, setTab] = useState(initialTab)
  const [editAcc, setEditAcc] = useState<Partial<Account> | null>(null)
  const [addBondTo, setAddBondTo] = useState<number | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const accounts = activeAccounts(data.accounts)
  const counted = accounts.filter(inTotal)
  const totalRub = counted.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const isBroker = (a: Account) => accountKind(a) === 'broker' || data.trades.some(t => t.accountId === a.id)
  const groups: [string, Account[]][] = tab === 'invest'
    ? [['Брокерские счета', accounts.filter(isBroker)]]
    : [
      ['Карты', accounts.filter(a => accountKind(a) === 'card')],
      ['Копилки', accounts.filter(a => accountKind(a) === 'savings')],
      ['Брокерские', accounts.filter(a => accountKind(a) === 'broker')],
      ['Кредиты и долги', accounts.filter(a => accountKind(a) === 'credit')],
      ['Мне должны', accounts.filter(a => accountKind(a) === 'debt')],
    ]
  const sum = (list: Account[]) => list.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)

  return (
    <div className="page">
      <div className="page-head"><h1>{tab === 'invest' ? 'Инвестиции' : 'Счета и цели'}</h1></div>
      {tab !== 'invest' && (
        <Segmented value={tab} onChange={v => setTab(v)} options={[{ value: 'accounts', label: 'Счета' }, { value: 'goals', label: 'Цели' }]} />
      )}

      {tab !== 'goals' && (
        <>
          <div className="trio duo">
            <div><span className="k">{tab === 'invest' ? 'Стоимость' : 'В общем балансе'}</span><span className="v"><Money v={tab === 'invest' ? sum(accounts.filter(isBroker)) : totalRub} /></span></div>
            <div><span className="k">{tab === 'invest' ? 'Позиций' : 'Счетов учтено'}</span><span className="v">{tab === 'invest' ? data.bondPositions.filter(p => p.qty > 0).length : `${counted.length} из ${accounts.length}`}</span></div>
          </div>
          {groups.filter(([, list]) => list.length).map(([title, list]) => (
            <div key={title}>
              <Section title={title} extra={<span className="small muted"><Money v={sum(list)} /></span>} />
              <div className="list">
                {list.map(a => {
                  const b = data.value.get(a.id!) ?? 0
                  const hasBonds = (data.bondValue.get(a.id!) ?? 0) > 0
                  const sub = [
                    a.id === data.settings.defaultAccountId ? 'основной' : null,
                    a.currency !== 'RUB' ? a.currency : null,
                    hasBonds ? null : data.recurring.some(r => r.reserveAccountId === a.id) ? 'резерв под платежи' : null,
                    inTotal(a) ? null : 'не в балансе',
                  ].filter(Boolean).join(' · ')
                  const credit = accountKind(a) === 'credit'
                  return (
                    <div key={a.id}>
                      <button className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => setEditAcc(a)}>
                        <AccountBadge account={a} color={data.colorOf(a)} size={30} />
                        <span className="body">
                          <span className="title">{a.name}</span>
                          {credit
                            ? <span className="sub">{b < 0 ? <>долг <Money v={-b} cur={a.currency} /></> : 'долга нет'}{a.creditLimit ? <> · доступно <Money v={Math.max(0, a.creditLimit + Math.min(0, b))} cur={a.currency} /></> : null}</span>
                            : hasBonds
                            ? <span className="sub">деньги <Money v={data.bal.get(a.id!) ?? 0} /> · облигации <Money v={data.bondValue.get(a.id!) ?? 0} /></span>
                            : sub && <span className="sub">{sub}</span>}
                        </span>
                        <span className={`amt ${b < 0 ? 'neg' : ''}`}>
                          <Money v={b} cur={a.currency} />
                          {a.currency !== 'RUB' && <span className="sub">≈ <Money v={data.toRub(b, a.currency) ?? 0} /></span>}
                        </span>
                      </button>
                      <BondList data={data} accountId={a.id!} onOpen={setPosition} />
                      {a.currency === 'RUB' && isBroker(a) && (
                        <button className="row noic" style={{ padding: '0 0.82rem 0 3.1rem', minHeight: '2.4rem' }} onClick={() => setAddBondTo(a.id!)}><span className="body link">+ Облигация</span></button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {tab === 'invest' && !accounts.some(isBroker) && <div className="list"><Empty title="Брокерских счетов нет">Добавь счёт с типом «Облигации» во вкладке «Счета».</Empty></div>}
          {tab === 'accounts' && <button className="secondary" onClick={() => setEditAcc({ currency: 'RUB' })}>+ Добавить счёт</button>}
          {foreignNote(accounts, data)}
        </>
      )}

      {tab === 'goals' && (
        <>
          <p className="hint">Цель — это часть денег копилки: прогресс считается по её балансу, второй раз деньги не учитываются.</p>
          {data.progress.length === 0 && <div className="list"><Empty title="Целей пока нет">Открой копилку во вкладке «Счета» и задай сумму цели и срок.</Empty></div>}
          {data.progress.map(p => {
            const a = data.accounts.find(x => x.id === p.goal.accountId)
            if (!a) return null
            const pct = p.goal.target > 0 ? Math.min(100, Math.floor((p.saved / p.goal.target) * 100)) : 0
            const plan = data.goalPlans.get(p.goal.id!)
            return (
              <div className="card goal-card" key={p.goal.id}>
                <div className="line" style={{ padding: 0 }}>
                  <strong className="title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.goal.name}</strong>
                  <span className="small muted">{p.goal.deadline ? `до ${monthGenitive(p.goal.deadline)}` : 'без срока'}</span>
                </div>
                <div className="line" style={{ padding: '0.2rem 0 0' }}>
                  <span className="big"><Money v={p.saved} cur={a.currency} /></span>
                  <span className="small muted">из <Money v={p.goal.target} cur={a.currency} /> · {pct}%</span>
                </div>
                <div className="bar thick"><div className="fill" style={{ width: `${Math.max(pct, p.saved > 0 ? 1 : 0)}%` }} /></div>
                <p className="hint" style={{ margin: '0.3rem 0 0' }}>
                  {p.remaining <= 0 ? <span className="pos">Цель собрана</span>
                    : p.goal.deadline && plan ? <>Откладывать <Money v={plan.monthly} cur={a.currency} /> в месяц{plan.left > 0 ? <>, в этом месяце ещё <Money v={plan.left} cur={a.currency} /></> : <> · <span className="pos">этот месяц закрыт</span></>}</>
                    : 'Срок не задан — ежемесячный взнос не считается.'}
                </p>
                <div className="btn-row">
                  <button className="save" onClick={() => onAdd({ type: 'transfer', toAccountId: a.id })}>Пополнить</button>
                  <button className="secondary" onClick={() => onOpenOps({ accountId: a.id })}>Операции</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {editAcc && <AccountSheet data={data} acc={editAcc} onClose={() => setEditAcc(null)}
        onOpenOps={editAcc.id != null ? () => { setEditAcc(null); onOpenOps({ accountId: editAcc.id }) } : undefined}
        onTransfer={editAcc.id != null ? () => { setEditAcc(null); onAdd({ type: 'transfer', accountId: editAcc.id }) } : undefined} />}
      {addBondTo != null && <AddBondSheet data={data} accountId={addBondTo} onClose={() => setAddBondTo(null)} />}
      {position && <PositionSheet data={data} position={position} onClose={() => setPosition(null)} />}
    </div>
  )
}

function foreignNote(accounts: Account[], data: Data) {
  return accounts.some(a => a.currency !== 'RUB') ? <p className="hint">Валютные счета переведены в рубли: {rateHint(data.latestRate)}.</p> : null
}

function AccountSheet({ data, acc, onClose, onOpenOps, onTransfer }: { data: Data; acc: Partial<Account>; onClose: () => void; onOpenOps?: () => void; onTransfer?: () => void }) {
  const [name, setName] = useState(acc.name ?? '')
  const [currency, setCurrency] = useState<Currency>(acc.currency ?? 'RUB')
  // Вводится текущий баланс; начальный подбирается так, чтобы с учётом всех операций получилось именно это.
  const current = acc.id != null ? data.bal.get(acc.id) ?? 0 : 0
  const isCredit0 = acc.id != null && accountKind(acc as Account) === 'credit'
  // У кредита вводится задолженность (положительным числом), хранится отрицательным остатком.
  const [now, setNow] = useState(isCredit0 ? (current < 0 ? toInput(-current) : '') : current > 0 ? toInput(current) : '')
  const [creditLimit, setCreditLimit] = useState(toInput(acc.creditLimit))
  const [isDefault, setIsDefault] = useState(acc.id != null && acc.id === data.settings.defaultAccountId)
  const [kind, setKind] = useState<AccountKind>(acc.id != null ? accountKind(acc as Account) : 'card')
  // null — цвет подбирается сам (по названию банка или следующий по порядку), пока не выбран вручную.
  const [color, setColor] = useState<AccountColor | null>(acc.color ?? null)
  const shownColor = color ?? (acc.id != null ? data.colorOf(acc as Account) : null)
  const [counted, setCounted] = useState(acc.inTotal !== false)
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
    const entered = fromInput(now)
    const wanted = entered == null ? null : kind === 'credit' ? -entered : entered
    const id = await db.accounts.put({
      ...(acc as Account), name: name.trim(), currency, openingBalance: wanted == null && current !== 0
        ? acc.openingBalance ?? 0 // поле очистили при отрицательном балансе — ничего не меняем
        : (acc.openingBalance ?? 0) + ((wanted ?? 0) - current),
      archived: acc.archived ?? false, order: acc.order ?? data.accounts.length, kind, color: color ?? undefined, inTotal: counted, taxFree,
      creditLimit: kind === 'credit' ? fromInput(creditLimit) ?? undefined : undefined,
    })
    if (isDefault) await saveSettings({ defaultAccountId: id })
    const t = kind === 'savings' || kind === 'broker' ? fromInput(target) : null
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
      {(onOpenOps || onTransfer) && (
        <div className="chips">
          {onOpenOps && <button className="pill-btn" onClick={onOpenOps}><Icon name="list" size={15} /> Операции</button>}
          {onTransfer && <button className="pill-btn" onClick={onTransfer}><Icon name="transfer" size={15} /> Перевести</button>}
        </div>
      )}
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Т-Банк, Наличные, Накопительный…" autoFocus={!acc.id} />
      <label className="field-label">Валюта</label>
      {used ? <div>{currency}</div> : <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />}
      <label className="field-label">{kind === 'credit' ? 'Сколько сейчас должен' : kind === 'debt' ? 'Сколько сейчас должны мне' : hasBonds ? 'Свободные деньги на счёте (без облигаций)' : 'Сейчас на счёте'}</label>
      <AmountInput value={now} onChange={setNow} suffix={CUR_SUFFIX[currency]} />
      {kind === 'credit' && (
        <>
          <label className="field-label">Кредитный лимит <span className="muted">(для кредитки, необязательно)</span></label>
          <AmountInput value={creditLimit} onChange={setCreditLimit} suffix={CUR_SUFFIX[currency]} placeholder="Нет" />
        </>
      )}
      <p className="hint">
        {acc.id ? 'Если не совпадает с банком — введи реальную сумму, история операций не изменится.' : 'Сколько на счёте прямо сейчас.'}
        {current < 0 && <> Сейчас по операциям: <Money v={current} cur={currency} />.</>}
      </p>
      <label className="field-label">Тип</label>
      <Chips options={[
        { value: 'card' as const, label: 'Карта', icon: 'card' as const },
        { value: 'savings' as const, label: 'Копилка', icon: 'target' as const },
        { value: 'broker' as const, label: 'Облигации', icon: 'percent' as const },
        { value: 'credit' as const, label: 'Кредит / долг', icon: 'banknote' as const },
        { value: 'debt' as const, label: 'Мне должны', icon: 'users' as const },
      ]} value={kind} onChange={setKind} />
      <p className="hint">{kind === 'broker'
        ? 'Брокерский счёт: сюда добавляются облигации («+ облигация» в списке счетов). Деньги на него переводишь как обычно.'
        : kind === 'credit'
        ? 'Кредитка, кредит, рассрочка или долг другу. Покупка по кредитке — расход с этого счёта; погашение — перевод сюда (не расход), проценты — расход. Кредитный лимит — не твои деньги и в баланс не входит.'
        : kind === 'debt'
        ? 'Кому дал в долг. Выдача — перевод сюда, возврат — перевод отсюда: это не расход и не доход.'
        : 'Карты показываются первыми при вводе трат, копилки — после.'}</p>
      <label className="field-label">Цвет</label>
      <div className="color-picker">
        {ACCOUNT_COLORS.map(c => (
          <button key={c} type="button" className={c === shownColor ? `acc-${c} on` : `acc-${c}`} aria-label={COLOR_LABEL[c]} onClick={() => setColor(c)}>
            {c === shownColor && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={counted} onChange={e => setCounted(e.target.checked)} /> Учитывать в общем балансе</label>
      <p className="hint" style={{ marginTop: 0 }}>{kind === 'card' ? 'Деньги этой карты войдут и в «Доступно до дохода».' : kind === 'credit' ? 'Долг вычитается из общего баланса. В «Доступно до дохода» кредит не входит.' : kind === 'debt' ? 'Долг мне входит в общий баланс как актив, но не в «Доступно до дохода».' : 'Копилки и облигации — резерв: в «Доступно до дохода» не входят.'}</p>
      {(kind === 'savings' || kind === 'broker') && (
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
            return <p className="hint">Откладывать ≈ <strong className="money">{formatMoney(per, currency)}</strong> в месяц до конца {monthGenitive(deadline)}.</p>
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
