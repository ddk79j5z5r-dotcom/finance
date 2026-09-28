import { useState } from 'react'
import { db } from '../db'
import { bucketStates, envelopes, planIncome } from '../domain/calc'
import { formatMoney, monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { BUCKET_LABEL, BUCKETS, INCOME_LABEL, type Category, type Recurring, type Tx } from '../domain/types'
import { AmountInput, Bar, fromInput, Money, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'
import { Distribute } from './Distribute'

export function Month({ data, onOpenBackup }: { data: Data; onOpenBackup: () => void }) {
  const [month, setMonth] = useState(monthOf(todayISO()))
  const [distribute, setDistribute] = useState<Tx | null>(null)
  const [limitFor, setLimitFor] = useState<Category | null>(null)
  const [pay, setPay] = useState<Recurring | null>(null)

  const buckets = bucketStates(data, month, data.settings)
  const envs = envelopes(data.categories, data.limits, data.txs, month)
  const income = planIncome(data.txs, month, data.settings)
  const incomes = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month)
  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = incomes.filter(t => !allocated.has(t.id!))
  const exportStale = !data.settings.lastExportAt || Date.now() - data.settings.lastExportAt > 7 * 864e5
  const hasData = data.txs.length > 0
  const noExpected = !data.settings.expectedSalary && !data.settings.expectedAdvance

  return (
    <div className="page">
      <div className="month-nav">
        <button className="link" onClick={() => setMonth(m => shiftMonth(m, -1))}>‹</button>
        <h1>{monthLabel(month)}</h1>
        <button className="link" onClick={() => setMonth(m => shiftMonth(m, 1))}>›</button>
      </div>

      {hasData && exportStale && (
        <button className="banner" onClick={onOpenBackup}>
          {data.settings.lastExportAt ? 'Бэкапа не было больше недели.' : 'Бэкап ещё ни разу не делался.'} Данные живут только в этом телефоне — сохрани Excel в iCloud →
        </button>
      )}

      {pending.map(t => (
        <button className="banner accent" key={t.id} onClick={() => setDistribute(t)}>
          {INCOME_LABEL[t.incomeKind!]} {formatMoney(t.rub)} — распределить →
        </button>
      ))}

      <div className="card">
        <div className="line">
          <span>Доход для плана</span>
          <strong><Money v={income} /></strong>
        </div>
        {noExpected && <p className="hint">Укажи ожидаемые зарплату и аванс в «Ещё → Выплаты», чтобы план был виден с начала месяца.</p>}
        {BUCKETS.map(b => {
          const s = buckets[b]
          const pct = data.settings.rule[b]
          return (
            <div className="bucket" key={b}>
              <div className="line">
                <span>{BUCKET_LABEL[b]} <span className="muted">{pct}%</span></span>
                <span><Money v={s.spent} /> <span className="muted">из {formatMoney(s.target)}</span></span>
              </div>
              <Bar value={s.spent} max={s.target} />
              {s.allocated > 0 && <div className="muted small">распределено из поступлений {formatMoney(s.allocated)}</div>}
              {b !== 'savings' && s.planned > s.target && s.target > 0 && (
                <p className="warn">Лимиты конвертов ({formatMoney(s.planned)}) больше {pct}% дохода</p>
              )}
            </div>
          )
        })}
      </div>

      {BUCKETS.filter(b => b !== 'savings').map(b => (
        <div className="card" key={b}>
          <h3>Конверты: {BUCKET_LABEL[b].toLowerCase()}</h3>
          {envs.filter(e => e.category.bucket === b && (e.limit || e.spent || e.carry || !e.category.system)).map(e => (
            <button className="envelope" key={e.category.id} onClick={() => setLimitFor(e.category)}>
              <div className="line">
                <span>{e.category.name}</span>
                {e.limit || e.carry
                  ? <strong className={e.available < 0 ? 'neg' : ''}><Money v={e.available} /></strong>
                  : <span className="muted small">задать лимит</span>}
              </div>
              {e.limit || e.carry ? (
                <>
                  <Bar value={e.spent} max={e.limit + Math.max(0, e.carry)} />
                  <div className="muted small">
                    потрачено {formatMoney(e.spent)} из {formatMoney(e.limit)}
                    {e.carry !== 0 && ` · перенос ${e.carry > 0 ? '+' : ''}${formatMoney(e.carry)}`}
                  </div>
                </>
              ) : (
                <div className="muted small">{e.spent ? `потрачено ${formatMoney(e.spent)} · ` : ''}лимит не задан</div>
              )}
            </button>
          ))}
        </div>
      ))}

      <div className="card">
        <h3>Регулярные платежи</h3>
        {data.recurring.filter(r => r.active).sort((a, b) => a.day - b.day).map(r => (
          <div className="line" key={r.id}>
            <span>
              {r.day}-го · {r.name}
              <div className="muted small">резерв из {r.fundFrom === 'salary' ? `зарплаты ${data.settings.salaryDay}-го` : `аванса ${data.settings.advanceDay}-го`}</div>
            </span>
            <span className="right">
              <Money v={r.amount} cur={r.currency} />
              <button className="link small" onClick={() => setPay(r)}>Оплатил</button>
            </span>
          </div>
        ))}
        {data.recurring.length === 0 && <p className="hint">Добавь аренду и кредит в «Ещё → Регулярные платежи».</p>}
      </div>

      {distribute && <Distribute data={data} tx={distribute} onClose={() => setDistribute(null)} />}
      {limitFor && <LimitSheet data={data} category={limitFor} month={month} onClose={() => setLimitFor(null)} />}
      {pay && <PaySheet data={data} r={pay} onClose={() => setPay(null)} />}
    </div>
  )
}

function LimitSheet({ data, category, month, onClose }: { data: Data; category: Category; month: string; onClose: () => void }) {
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
      <p className="hint">Остаток и перерасход переносятся в этот же конверт на следующий месяц.</p>
      <button className="primary" onClick={save}>Сохранить</button>
    </Sheet>
  )
}

/** «Оплатил» по регулярному платежу — создаёт расход с его категорией. */
function PaySheet({ data, r, onClose }: { data: Data; r: Recurring; onClose: () => void }) {
  const accounts = data.accounts.filter(a => !a.archived && a.currency === r.currency)
  const [accountId, setAccountId] = useState(accounts.find(a => a.id === data.settings.defaultAccountId)?.id ?? accounts[0]?.id)
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
      <button className="primary" onClick={save} disabled={accounts.length === 0}>Записать расход</button>
    </Sheet>
  )
}
