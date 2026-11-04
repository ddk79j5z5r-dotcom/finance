import { useState } from 'react'
import { db, saveSettings } from '../db'
import { moveAndDeleteAccount } from '../domain/accounts'
import { accountKind, monthsUntil } from '../domain/calc'
import type { Position } from '../domain/bonds'
import { AddBondSheet, BondList, PositionSheet } from './Bonds'
import { formatMoney, monthGenitive, monthOf, plural, todayISO } from '../domain/money'
import { ACCOUNT_COLORS, CURRENCIES, type Account, type AccountColor, type AccountKind, type Currency } from '../domain/types'
import { AccountBadge, COLOR_LABEL } from './AccountBadge'
import { AmountInput, BigMoney, Chips, CUR_SUFFIX, Empty, fromInput, Money, Section, Segmented, Sheet, toInput, useOnce } from './common'
import { BondEventRow } from './rows'
import { goalPct, monthYear } from '../domain/format'
import { bondEvents } from '../domain/bonds'
import { inTotal } from '../domain/plan'
import { activeAccounts, rateHint, type Data } from './data'
import type { OpsFilter } from '../domain/ops'
import { Icon } from './icons'
import { notify } from './undo'

const KIND_LABEL: Record<AccountKind, string> = { card: 'карта', savings: 'накопления', broker: 'брокерский счёт', credit: 'кредит', debt: 'мне должны' }

export type EntryPreset = { type?: 'expense' | 'income' | 'transfer'; accountId?: number; toAccountId?: number }

/** Счета и цели — разные сущности: переключателем. «Инвестиции» — те же счета, только брокерские с облигациями. */
export function Accounts({ data, onOpenOps, onAdd, initialTab = 'accounts' }: {
  data: Data; onOpenOps: (f: OpsFilter) => void; onAdd: (p: EntryPreset) => void; initialTab?: 'accounts' | 'goals' | 'invest'
}) {
  const [tab, setTab] = useState(initialTab)
  const [goalFilter, setGoalFilter] = useState<'all' | 'active' | 'done'>('all')
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
      ['Накопления', accounts.filter(a => accountKind(a) === 'savings')],
      ['Инвестиции', accounts.filter(a => accountKind(a) === 'broker')],
      ['Кредиты и долги', accounts.filter(a => accountKind(a) === 'credit')],
      ['Мне должны', accounts.filter(a => accountKind(a) === 'debt')],
    ]
  const sum = (list: Account[]) => list.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)

  const goalsAll = data.progress.filter(p => data.accounts.some(a => a.id === p.goal.accountId))
  const goalsShown = goalsAll.filter(p => goalFilter === 'all' || (goalFilter === 'done') === (p.remaining <= 0))
  const brokers = accounts.filter(isBroker)
  const portfolio = sum(brokers)
  const cashInBroker = brokers.reduce((s, a) => s + (data.toRub(data.bal.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const profit = data.bondPositions.filter(p => p.qty > 0).reduce((s, p) => s + p.profit, 0)
  const in60 = new Date(todayISO() + 'T00:00:00'); in60.setDate(in60.getDate() + 60)
  const coupons = tab === 'invest' ? bondEvents(data.trades, data.bonds, todayISO(), todayISO(in60), data.taxFree).slice(0, 5) : []
  const title = tab === 'invest' ? 'Инвестиции' : tab === 'goals' ? 'Цели' : 'Счета'

  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <div className="head-actions">
          {tab !== 'invest' && <button className="round-btn accent" aria-label={tab === 'goals' ? 'Новая цель — копилка' : 'Новый счёт'} onClick={() => setEditAcc(tab === 'goals' ? { currency: 'RUB', kind: 'savings' } : { currency: 'RUB' })}><Icon name="plus" size={20} stroke={2.2} /></button>}
        </div>
      </div>
      {tab !== 'invest' && (
        <Segmented value={tab} onChange={v => setTab(v)} options={[{ value: 'accounts', label: 'Счета' }, { value: 'goals', label: 'Цели' }]} />
      )}

      {tab === 'accounts' && (
        <section className="hero acc-hero">
          <div className="hero-main">
            <span className="cap">Всего на счетах</span>
            <BigMoney v={totalRub} className="hero-v" />
            <span className="hero-day"><i className="ok-dot" />Включено в общую сумму: {counted.length} из {accounts.length}</span>
          </div>
        </section>
      )}

      {tab === 'invest' && (
        <section className="hero acc-hero">
          <div className="hero-main">
            <span className="cap">Стоимость портфеля</span>
            <BigMoney v={portfolio} className="hero-v" />
            {data.bondPositions.some(p => p.qty > 0) && <span className={`hero-day ${profit >= 0 ? 'pos' : 'neg'}`}><Money v={profit} sign /> <span className="muted">— результат с покупки, с купонами</span></span>}
          </div>
          <div className="hero-total" style={{ cursor: 'default' }}>
            <span>Свободные деньги<span className="hero-scope">на брокерских счетах</span></span>
            <span className="hero-total-v"><Money v={cashInBroker} />{brokers[0] && <button className="fill-btn" style={{ marginLeft: 8 }} onClick={() => onAdd({ type: 'transfer', toAccountId: brokers[0].id })}>Пополнить</button>}</span>
          </div>
        </section>
      )}

      {tab !== 'goals' && (
        <>
          {groups.filter(([, list]) => list.length).map(([gTitle, list]) => (
            <div className="list grp" key={gTitle}>
              <header className="grp-head"><span>{gTitle}</span><span className={sum(list) < 0 ? 'neg' : ''}><Money v={sum(list)} /></span></header>
                {list.map(a => {
                  const b = data.value.get(a.id!) ?? 0
                  const hasBonds = (data.bondValue.get(a.id!) ?? 0) > 0
                  const sub = [
                    a.id === data.settings.defaultAccountId ? 'основной' : KIND_LABEL[accountKind(a)],
                    a.currency !== 'RUB' ? a.currency : null,
                    hasBonds ? null : data.recurring.some(r => r.reserveAccountId === a.id) ? 'резерв под платежи' : null,
                    inTotal(a) ? null : 'не в балансе',
                  ].filter(Boolean).join(' · ')
                  const credit = accountKind(a) === 'credit'
                  return (
                    <div key={a.id}>
                      <button className="row" style={{ padding: '0.42rem 0.82rem' }} onClick={() => setEditAcc(a)}>
                        <AccountBadge account={a} color={data.colorOf(a)} size={34} />
                        <span className="body">
                          <span className="title">{a.name}</span>
                          {credit
                            ? <span className="sub">{a.creditLimit ? <>лимит <Money v={a.creditLimit} cur={a.currency} whole /> · доступно <Money v={Math.max(0, a.creditLimit + Math.min(0, b))} cur={a.currency} whole /></> : 'задолженность'}</span>
                            : hasBonds
                            ? <span className="sub">деньги <Money v={data.bal.get(a.id!) ?? 0} /> · облигации <Money v={data.bondValue.get(a.id!) ?? 0} /></span>
                            : sub && <span className="sub">{sub}</span>}
                        </span>
                        <span className={`amt ${b < 0 ? 'neg' : ''}`}>
                          <Money v={b} cur={a.currency} />
                          {credit && b < 0 && <span className="sub">долг</span>}
                          {a.currency !== 'RUB' && <span className="sub">≈ <Money v={data.toRub(b, a.currency) ?? 0} /></span>}
                        </span>
                      </button>
                      <BondList data={data} accountId={a.id!} onOpen={setPosition} />
                      {a.currency === 'RUB' && isBroker(a) && (
                        <button className="row noic" style={{ padding: '0 0.82rem 0 3.1rem', minHeight: '2.6rem' }} onClick={() => setAddBondTo(a.id!)}><span className="body link">+ Облигация</span></button>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {tab === 'invest' && !accounts.some(isBroker) && <div className="list"><Empty title="Брокерских счетов нет">Добавь счёт с типом «Облигации» во вкладке «Счета».</Empty></div>}
          {tab === 'invest' && accounts.some(isBroker) && (
            <>
              <Section title="Ближайшие выплаты" />
              <div className="list">
                {coupons.length === 0 && <Empty title="Выплат в ближайшие 60 дней нет" />}
                {coupons.map(e => <BondEventRow key={e.key} e={e} />)}
              </div>
              <p className="hint">Цена облигации — в процентах от номинала; стоимость позиции — по последней цене биржи плюс НКД. График стоимости портфеля появится, когда накопится история цен — сейчас она не сохраняется.</p>
            </>
          )}
          {foreignNote(accounts, data)}
        </>
      )}

      {tab === 'goals' && (
        <>
          <div className="pills" role="group" aria-label="Какие цели показать">
            {([['all', 'Все', goalsAll.length], ['active', 'Активные', goalsAll.filter(p => p.remaining > 0).length], ['done', 'Достигнутые', goalsAll.filter(p => p.remaining <= 0).length]] as const).map(([v, l, n]) => (
              <button key={v} className={goalFilter === v ? 'on' : undefined} aria-pressed={goalFilter === v} onClick={() => setGoalFilter(v)}>{l}<span className="n">{n}</span></button>
            ))}
          </div>
          {goalsAll.length === 0 && <div className="list"><Empty title="Целей пока нет">Нажми «+», создай копилку и задай сумму цели и срок.</Empty></div>}
          {goalsAll.length > 0 && goalsShown.length === 0 && <div className="list"><Empty title={goalFilter === 'done' ? 'Достигнутых целей пока нет' : 'Все цели достигнуты'} /></div>}
          {goalsShown.map(p => {
            const a = data.accounts.find(x => x.id === p.goal.accountId)!
            const g = goalPct(p.saved, p.goal.target)
            const plan = data.goalPlans.get(p.goal.id!)
            return (
              <div className="card goal-card" key={p.goal.id}>
                <button className="goal-top" onClick={() => setEditAcc(a)} aria-label={`${p.goal.name}: изменить`}>
                  <span className="goal-ico"><AccountBadge account={a} color={data.colorOf(a)} size={40} /></span>
                  <span className="body">
                    <span className="title">{p.goal.name}</span>
                    <span className="goal-sum"><Money v={p.saved} cur={a.currency} whole /> <span className="muted">из <Money v={p.goal.target} cur={a.currency} whole /></span></span>
                  </span>
                </button>
                <div className="goal-line"><span className="bar thick"><span className="fill" style={{ display: 'block', width: `${g.width}%` }} /></span><span className="pct">{g.label}</span></div>
                {p.remaining > 0 && p.goal.deadline && plan && (
                  <p className="goal-plan">Взнос <Money v={plan.monthly} cur={a.currency} whole /> в месяц · {plan.left > 0 ? <>в этом месяце ещё <Money v={plan.left} cur={a.currency} whole /></> : <span className="pos">этот месяц закрыт</span>}</p>
                )}
                <div className="goal-foot">
                  <span className="sub">{p.remaining <= 0 ? <span className="pos">Цель собрана</span> : p.goal.deadline ? <>До {monthYear(p.goal.deadline)}</> : 'Без срока'}</span>
                  <span className="goal-actions">
                    <button className="link" style={{ minHeight: 44 }} onClick={() => onOpenOps({ accountId: a.id })}>История</button>
                    {p.remaining > 0 && <button className="outline-btn" onClick={() => onAdd({ type: 'transfer', toAccountId: a.id })}>Пополнить</button>}
                  </span>
                </div>
              </div>
            )
          })}
          {goalsAll.length > 0 && <p className="hint">Цель — часть денег копилки: прогресс считается по её балансу, второй раз деньги не учитываются.</p>}
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
  const [kind, setKind] = useState<AccountKind>(acc.id != null ? accountKind(acc as Account) : acc.kind ?? 'card')
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
