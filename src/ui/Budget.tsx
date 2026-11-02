import { useState } from 'react'
import { db } from '../db'
import { envelopePlan, envelopes, plannedInMonth, subEnvelopes, type Envelope, type PlannedEvent } from '../domain/calc'
import { monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { INCOME_LABEL, type Category, type Tx } from '../domain/types'
import { AccountBadge } from './AccountBadge'
import { AmountInput, Empty, fromInput, Money, MonthNav, Section, Segmented, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'
import type { OpsFilter } from './History'
import { Icon } from './icons'
import { CategoryRow, EventRow, EventSheet, TxSheet } from './rows'
import { useMonthSlide } from './nav'

type Sort = 'spent' | 'left' | 'over'

export function Budget({ data, onDistribute, onOpenOps }: { data: Data; onDistribute: (t: Tx) => void; onOpenOps: (f: OpsFilter) => void }) {
  const [month, setMonth] = useState(monthOf(todayISO()))
  const [sort, setSort] = useState<Sort>('spent')
  const [opened, setCat] = useState<Envelope | null>(null)
  const [limitFor, setLimitFor] = useState<Category | null>(null)
  const [ev, setEv] = useState<PlannedEvent | null>(null)
  const [tx, setTx] = useState<Tx | null>(null)
  const slide = useMonthSlide(month)

  // Бюджет основной категории — её лимит, а без него — сумма лимитов подкатегорий; дети не добавляются к лимиту родителя.
  const subsOf = (id: number) => subEnvelopes(data.categories, data.limits, data.txs, month, id)
  const envs = envelopes(data.categories, data.limits, data.txs, month)
    .filter(e => e.hasLimit || e.spent || (!e.category.system && !e.category.archived))
    .map(e => { const p = envelopePlan(e, subsOf(e.category.id!)); return { ...e, limit: p.limit, hasLimit: p.hasLimit, available: p.limit - e.spent, fromSubs: p.fromSubs } })
  const cat = opened && envs.find(e => e.category.id === opened.category.id)
  const withLimit = envs.filter(e => e.hasLimit)
  const plan = withLimit.reduce((s, e) => s + e.limit, 0)
  const spent = envs.reduce((s, e) => s + e.spent, 0)
  const left = plan - withLimit.reduce((s, e) => s + e.spent, 0)
  const overCount = withLimit.filter(e => e.spent > e.limit).length

  const sorted = [...envs].sort((a, b) => {
    if (sort === 'spent') return b.spent - a.spent
    if (sort === 'left') { // меньше всего осталось — сверху; без лимита — в конце
      if (a.hasLimit !== b.hasLimit) return a.hasLimit ? -1 : 1
      return a.available - b.available
    }
    const oa = a.hasLimit ? a.spent - a.limit : -Infinity, ob = b.hasLimit ? b.spent - b.limit : -Infinity
    return ob - oa
  })

  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const payments = plannedInMonth(data.recurring, data.settings, month).filter(e => e.kind === 'payment')
  const topups = data.recurring.filter(r => r.active && r.kind === 'topup')

  return (
    <div className="page">
      <div className="page-head"><h1>Бюджет</h1></div>
      <MonthNav label={monthLabel(month)} onPrev={() => setMonth(m => shiftMonth(m, -1))} onNext={() => setMonth(m => shiftMonth(m, 1))} />
      <div ref={slide}>

      {pending.length > 0 && (
        <div className="list">
          {pending.map(t => (
            <button className="notice" key={t.id} onClick={() => onDistribute(t)}>
              <i className="dot" /><span className="body">{INCOME_LABEL[t.incomeKind!]} <Money v={t.rub} /> — сколько отложить</span><Icon name="right" size={14} />
            </button>
          ))}
        </div>
      )}

      <div className="trio">
        <div><span className="k">План</span><span className="v">{plan ? <Money v={plan} /> : '—'}</span></div>
        <div><span className="k">Потрачено</span><span className="v"><Money v={spent} /></span></div>
        <div><span className="k">{left < 0 ? 'Перерасход' : 'Осталось'}</span><span className={`v ${left < 0 ? 'neg' : ''}`}>{plan ? <Money v={Math.abs(left)} /> : '—'}</span></div>
      </div>
      {plan > 0 && (
        <div className="bar thick" style={{ margin: '-0.3rem 0.2rem 0.4rem' }} aria-hidden="true">
          <div className={spent > plan ? 'fill over' : 'fill'} style={{ width: `${Math.min(100, (spent / plan) * 100)}%` }} />
        </div>
      )}
      {!plan && <p className="hint">Лимиты не заданы — нажми на категорию, чтобы задать.</p>}

      <Section title="Категории" extra={overCount > 0 ? <span className="pill" style={{ color: 'var(--neg)' }}>перерасход: {overCount}</span> : undefined} />
      <Segmented value={sort} onChange={setSort} options={[
        { value: 'spent', label: 'По расходам' }, { value: 'left', label: 'По остатку' }, { value: 'over', label: 'Перерасход' },
      ]} />
      <div className="list">
        {sorted.length === 0 && <Empty title="Нет категорий">Добавь их в «Ещё → Категории».</Empty>}
        {sorted.map(e => <CategoryRow key={e.category.id} e={e} onOpen={setCat} categories={data.categories} note={e.fromSubs ? 'по подкатегориям' : undefined} />)}
      </div>

      <Section title="Обязательные платежи" />
      <div className="list">
        {payments.length === 0 && <Empty title="Платежей нет">Добавь аренду и кредит в «Ещё → Регулярные платежи».</Empty>}
        {payments.map(e => <EventRow key={`${e.date}${e.kind === 'payment' ? e.recurring.id : ''}`} e={e} data={data} onOpen={setEv} />)}
      </div>

      {topups.length > 0 && (
        <>
          <Section title="Пополнения копилок" />
          <div className="list">
            {topups.map(r => {
              const acc = data.accounts.find(a => a.id === r.reserveAccountId)
              const inMonth = data.txs.filter(t => t.type === 'transfer' && t.toAccountId === r.reserveAccountId && monthOf(t.date) === month).reduce((s, t) => s + (t.toAmount ?? t.amount), 0)
              const done = inMonth >= r.amount
              return (
                <div className="row" key={r.id} style={{ padding: '0.42rem 0.82rem' }}>
                  {acc && <AccountBadge account={acc} color={data.colorOf(acc)} size={30} />}
                  <span className="body"><span className="title">{acc?.name ?? r.name}</span><span className="sub">{done ? <span className="pos">пополнено</span> : <>внесено <Money v={inMonth} /></>}</span></span>
                  <span className="amt"><Money v={r.amount} cur={r.currency} /><span className="sub">в месяц</span></span>
                </div>
              )
            })}
          </div>
        </>
      )}

      </div>

      {cat && (() => {
        const subs = subsOf(cat.category.id!).sort((a, b) => b.spent - a.spent || (a.category.order ?? 0) - (b.category.order ?? 0))
        const direct = cat.spent - subs.reduce((s, x) => s + x.spent, 0)
        const own = data.limits.some(l => l.categoryId === cat.category.id) && envelopes(data.categories, data.limits, data.txs, month).find(x => x.category.id === cat.category.id)?.hasLimit
        const subPlan = subs.filter(x => x.hasLimit).reduce((s, x) => s + x.limit, 0)
        return (
          <Sheet title={cat.category.name} onClose={() => setCat(null)}>
            <div className="list"><CategoryRow e={cat} onOpen={() => {}} categories={data.categories} note={cat.fromSubs ? 'по подкатегориям' : undefined} /></div>
            {subs.length > 0 && (
              <>
                <Section title="Подкатегории" />
                <div className="list">
                  {subs.map(x => <CategoryRow key={x.category.id} e={x} categories={data.categories} note="без своего лимита" onOpen={() => { setLimitFor(x.category); setCat(null) }} />)}
                  {direct !== 0 && <div className="row noic" style={{ padding: '0.42rem 0.82rem' }}><span className="body"><span className="title">Без подкатегории</span><span className="sub">выбрана только «{cat.category.name}»</span></span><span className="amt"><Money v={direct} /></span></div>}
                </div>
                <p className="hint">Лимиты подкатегорий — детализация бюджета «{cat.category.name}», к нему они не прибавляются. {own ? 'Действует лимит самой категории.' : subPlan ? 'Своего лимита нет — бюджет равен сумме лимитов подкатегорий.' : ''}{own && subPlan > cat.limit ? ' Сумма лимитов подкатегорий больше лимита категории.' : ''} Нажми на подкатегорию, чтобы задать её лимит.</p>
              </>
            )}
            <div className="btn-row">
              <button className="secondary" onClick={() => { setCat(null); onOpenOps({ categoryId: cat.category.id, from: month, to: month }) }}><Icon name="list" size={16} /> Операции</button>
              <button className="save" onClick={() => { setLimitFor(cat.category); setCat(null) }}>{own ? 'Изменить лимит' : 'Задать лимит'}</button>
            </div>
          </Sheet>
        )
      })()}
      {limitFor && <LimitSheet data={data} category={limitFor} month={month} onClose={() => setLimitFor(null)} />}
      {ev && <EventSheet data={data} e={ev} onClose={() => setEv(null)} onOpenTx={setTx} />}
      {tx && <TxSheet data={data} tx={tx} onClose={() => setTx(null)} />}
    </div>
  )
}

/** Лимит с этого месяца. Можно задать 0 ₽ (тратить нельзя) или снять лимит совсем. */
export function LimitSheet({ data, category, month, onClose }: { data: Data; category: Category; month: string; onClose: () => void }) {
  const cur = (category.parentId != null ? subEnvelopes(data.categories, data.limits, data.txs, month, category.parentId) : envelopes(data.categories, data.limits, data.txs, month)).find(e => e.category.id === category.id)
  const parent = data.categories.find(c => c.id === category.parentId)
  const [value, setValue] = useState(cur?.hasLimit ? toInput(cur.limit) || '0' : '')
  const put = async (amount: number, strict: boolean) => {
    const existing = data.limits.find(l => l.categoryId === category.id && l.month === month)
    await db.limits.put({ ...(existing ?? {}), categoryId: category.id!, month, amount, strict })
  }
  const save = useOnce(async () => {
    const amount = fromInput(value)
    if (value.trim() === '' || amount == null) await put(0, false)
    else await put(amount, true)
    onClose()
  })
  const clear = useOnce(async () => { await put(0, false); onClose() })
  return (
    <Sheet title={parent ? `${parent.name} · ${category.name}` : category.name} onClose={onClose}>
      <label className="field-label">Лимит в месяц начиная с «{monthLabel(month)}»</label>
      <AmountInput value={value} onChange={setValue} suffix="₽" autoFocus placeholder="Без лимита" />
      <p className="hint">Действует каждый месяц, пока не изменишь. Остаток и перерасход на следующий месяц не переносятся. 0 ₽ — значит, в этой категории тратить не планируешь.{parent && ` Лимит подкатегории входит в бюджет «${parent.name}» и не увеличивает его.`}</p>
      <button className="save" onClick={save}>Сохранить</button>
      {cur?.hasLimit && <button className="secondary" onClick={clear}>Снять лимит</button>}
    </Sheet>
  )
}
