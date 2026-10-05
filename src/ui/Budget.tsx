import { useState } from 'react'
import { db } from '../db'
import { bucketStates, envelopes, isPaid, planIncome } from '../domain/calc'
import { formatMoney, monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { BUCKET_LABEL, BUCKETS, INCOME_LABEL, type Category, type Recurring, type Tx } from '../domain/types'
import { AmountInput, Bar, fromInput, Money, MonthNav, Sheet, toInput, useOnce } from './common'
import { AccountBadge } from './AccountBadge'
import type { Data } from './data'
import type { OpsFilter } from './History'
import { Badge, categoryIcon, Icon } from './icons'

export function Budget({ data, onDistribute, onOpenOps }: { data: Data; onDistribute: (t: Tx) => void; onOpenOps: (f: OpsFilter) => void }) {
  const [month, setMonth] = useState(monthOf(todayISO()))
  const [pay, setPay] = useState<Recurring | null>(null)

  const buckets = bucketStates(data, month, data.settings)
  const envs = envelopes(data.categories, data.limits, data.txs, month)
    .filter(e => e.limit || e.spent || !e.category.system)
  const income = planIncome(data.txs, month, data.settings)
  const plan = envs.reduce((s, e) => s + e.limit, 0)
  const fact = envs.reduce((s, e) => s + e.spent, 0)
  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const noExpected = !data.settings.expectedSalary && !data.settings.expectedAdvance
  const active = data.recurring.filter(r => r.active)
  const payments = active.filter(r => r.kind !== 'topup').sort((a, b) => a.day - b.day)
  const topups = active.filter(r => r.kind === 'topup')
  const fundLabel = (r: Recurring) => r.fundFrom === 'both' ? 'пополам из зарплаты и аванса'
    : r.fundFrom === 'salary' ? `из зарплаты ${data.settings.salaryDay}-го` : `из аванса ${data.settings.advanceDay}-го`
  const paid = (r: Recurring) => isPaid(r, data.txs, month, x => data.toRub(x.amount, x.currency) ?? x.amount)
  // С лимитом — сверху, по доле израсходованного; без лимита — ниже, по сумме трат.
  const sorted = [...envs].sort((a, b) => {
    const la = a.limit, lb = b.limit
    if (!!la !== !!lb) return la ? -1 : 1
    return la ? b.spent / lb - a.spent / la : b.spent - a.spent
  })

  return (
    <div className="page">
      <div className="page-head"><h1>Бюджет</h1></div>
      <MonthNav label={monthLabel(month)} onPrev={() => setMonth(m => shiftMonth(m, -1))} onNext={() => setMonth(m => shiftMonth(m, 1))} />

      {pending.map(t => (
        <button className="banner accent-b" key={t.id} onClick={() => onDistribute(t)}>
          <Badge icon="banknote" tone="income" size={34} />
          <span className="body">{INCOME_LABEL[t.incomeKind!]} <strong><Money v={t.rub} /></strong> — распределить</span>
          <Icon name="right" size={18} />
        </button>
      ))}

      <div className="card">
        <div className="muted small">План расходов</div>
        <div className="line" style={{ padding: '2px 0' }}>
          <span style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em' }}><Money v={plan} round /></span>
          <span className="pct">{plan ? Math.round((fact / plan) * 100) : 0}%</span>
        </div>
        <Bar value={fact} max={plan} thick color="var(--pos)" />
        <div className="line small">
          <span>Факт <strong className="num"><Money v={fact} round /></strong></span>
          <span className="muted">{plan >= fact ? 'Осталось ' : 'Перерасход '}<strong className={plan >= fact ? '' : 'neg'}><Money v={Math.abs(plan - fact)} round /></strong></span>
        </div>
      </div>

      <div className="card">
        <div className="line" style={{ paddingTop: 0 }}>
          <h3>Правило {data.settings.rule.needs}/{data.settings.rule.wants}/{data.settings.rule.savings}</h3>
          <span className="muted small">доход <Money v={income} round /></span>
        </div>
        {noExpected && <p className="hint">Укажи ожидаемые зарплату и аванс в «Ещё → Выплаты», чтобы план был виден с начала месяца.</p>}
        {BUCKETS.map(b => {
          const s = buckets[b]
          return (
            <div key={b} style={{ marginTop: 10 }}>
              <div className="line small" style={{ padding: 0 }}>
                <span><strong>{BUCKET_LABEL[b]}</strong> <span className="muted">{data.settings.rule[b]}%</span></span>
                <span className="num"><Money v={s.spent} round /> <span className="muted">/ <Money v={s.target} round /></span></span>
              </div>
              <Bar value={s.spent} max={s.target} color={`var(--${b})`} />
              {b !== 'savings' && s.planned > s.target && s.target > 0 && (
                <p className="warn">Лимиты конвертов ({formatMoney(s.planned)}) больше {data.settings.rule[b]}% дохода</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="section-title"><h3>Категории</h3><span className="muted small">нажми — траты и лимит</span></div>
      <div className="card tight">
        {sorted.map(e => {
          const cap = e.limit
          return (
            <button className="row" key={e.category.id} onClick={() => onOpenOps({ categoryId: e.category.id, from: month, to: month })}>
              <Badge icon={categoryIcon(e.category)} tone={e.category.bucket} />
              <div className="body">
                <div className="line" style={{ padding: 0 }}>
                  <span className="title">{e.category.name}</span>
                  <span className="num small"><Money v={e.spent} round />{cap > 0 && <span className="muted"> / <Money v={cap} round /></span>}</span>
                </div>
                {cap > 0 ? (
                  <>
                    <Bar value={e.spent} max={cap} color={`var(--${e.category.bucket})`} />
                    <div className={`small num ${e.available < 0 ? 'neg' : 'muted'}`}>
                      {e.available < 0 ? 'перерасход ' : 'осталось '}{formatMoney(Math.round(Math.abs(e.available) / 100) * 100)}
                    </div>
                  </>
                ) : <div className="sub">лимит не задан</div>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="section-title"><h3>Регулярные платежи</h3></div>
      <div className="card tight">
        {payments.length === 0 && <p className="hint">Добавь аренду и кредит в «Ещё → Регулярные платежи».</p>}
        {payments.map(r => {
          const done = paid(r)
          return (
            <div className="row" key={r.id}>
              <Badge icon={categoryIcon(data.categories.find(c => c.id === r.categoryId))} tone="needs" />
              <div className="body">
                <div className="title">{r.name} · {r.day}-го</div>
                <div className="sub">{fundLabel(r)}{r.reserveAccountId != null && ` → ${data.accounts.find(a => a.id === r.reserveAccountId)?.name ?? ''}`}</div>
              </div>
              <div className="amt">
                <Money v={r.amount} cur={r.currency} />
                <div>{done
                  ? <span className="pos small">✓ оплачено</span>
                  : <button className="link small" onClick={() => setPay(r)}>Оплатил</button>}</div>
              </div>
            </div>
          )
        })}
      </div>

      {topups.length > 0 && (
        <>
          <div className="section-title"><h3>Пополнения копилок</h3></div>
          <div className="card tight">
            {topups.map(r => {
              const acc = data.accounts.find(a => a.id === r.reserveAccountId)
              const inMonth = data.txs.filter(t => t.type === 'transfer' && t.toAccountId === r.reserveAccountId && monthOf(t.date) === month).reduce((s, t) => s + (t.toAmount ?? t.amount), 0)
              return (
                <div className="row" key={r.id}>
                  {acc ? <AccountBadge account={acc} color={data.colorOf(acc)} /> : <Badge icon="target" tone="savings" />}
                  <div className="body">
                    <div className="title">{acc?.name ?? r.name}</div>
                    <div className="sub">{fundLabel(r)}</div>
                  </div>
                  <div className="amt">
                    <Money v={r.amount} cur={r.currency} round />
                    <div className={`small ${inMonth >= r.amount ? 'pos' : 'muted'}`}>{inMonth >= r.amount ? '✓ пополнено' : <>внесено <Money v={inMonth} round /></>}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {pay && <PaySheet data={data} r={pay} onClose={() => setPay(null)} />}
    </div>
  )
}

export function LimitSheet({ data, category, month, onClose }: { data: Data; category: Category; month: string; onClose: () => void }) {
  const cur = envelopes(data.categories, data.limits, data.txs, month).find(e => e.category.id === category.id)
  const [value, setValue] = useState(toInput(cur?.limit))
  const save = useOnce(async () => {
    const amount = fromInput(value) ?? 0
    const existing = data.limits.find(l => l.categoryId === category.id && l.month === month)
    await db.limits.put({ ...(existing ?? {}), categoryId: category.id!, month, amount })
    onClose()
  })
  return (
    <Sheet title={category.name} onClose={onClose}>
      <label className="field-label">Лимит в месяц начиная с «{monthLabel(month)}»</label>
      <AmountInput value={value} onChange={setValue} suffix="₽" autoFocus />
      <p className="hint">Лимит действует каждый месяц, пока не изменишь. Каждый месяц конверт начинается заново — остаток и перерасход не переносятся.</p>
      <button className="save" onClick={save}>Сохранить</button>
    </Sheet>
  )
}

/** «Оплатил» по регулярному платежу — создаёт расход с его категорией. */
function PaySheet({ data, r, onClose }: { data: Data; r: Recurring; onClose: () => void }) {
  const accounts = data.accounts.filter(a => !a.archived && a.currency === r.currency)
  const [accountId, setAccountId] = useState(
    accounts.find(a => a.id === r.reserveAccountId)?.id ?? accounts.find(a => a.id === data.settings.defaultAccountId)?.id ?? accounts[0]?.id,
  )
  const [value, setValue] = useState(toInput(r.amount))
  const save = useOnce(async () => {
    const amount = fromInput(value)
    if (!amount || accountId == null) return
    const rub = r.currency === 'RUB' ? amount : data.toRub(amount, r.currency)
    if (rub == null) return
    await db.txs.add({ date: todayISO(), type: 'expense', accountId, amount, rub, categoryId: r.categoryId, comment: r.name, createdAt: Date.now() })
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
