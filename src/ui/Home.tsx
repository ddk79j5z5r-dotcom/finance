import { monthForecast, monthTotals, netChangeSince, savingsRate, upcoming, type PlannedEvent } from '../domain/calc'
import { bondEvents, type BondEvent } from '../domain/bonds'
import { BondEventSheet } from './Bonds'
import { useState } from 'react'
import { AccountDot } from './AccountBadge'
import { formatMoney, monthOf, todayISO } from '../domain/money'
import { INCOME_LABEL, type Bucket, type Tx } from '../domain/types'
import { Money, setAmountsHidden, useAmountsHidden } from './common'
import { activeAccounts, type Data } from './data'
import { Badge, categoryIcon, Icon, type IconName } from './icons'

const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function inDays(date: string, today: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 864e5)
  if (n < 0) return ''
  return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`
}

export function Home({ data, onDistribute, onOpenBudget, onOpenCalendar, onOpenBackup, onOpenAccounts, onOpenAnalytics }: {
  data: Data
  onDistribute: (t: Tx) => void
  onOpenBudget: () => void
  onOpenCalendar: () => void
  onOpenBackup: () => void
  onOpenAccounts: () => void
  onOpenAnalytics: (mode: 'income' | 'expense') => void
}) {
  const hidden = useAmountsHidden()
  const today = todayISO()
  const month = monthOf(today)
  const accounts = activeAccounts(data.accounts)
  const total = accounts.reduce((s, a) => s + (data.toRub(data.value.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  // Под балансом — счета с галочкой «на главной»; если не отмечен ни один — основной счёт.
  const flagged = accounts.filter(a => a.showOnHome)
  const homeAccounts = flagged.length ? flagged : accounts.filter(a => a.id === data.settings.defaultAccountId)
  const since = new Date(); since.setDate(since.getDate() - 29)
  const delta = netChangeSince(data.txs, todayISO(since))
  const totals = monthTotals(data.txs, month)
  const in31 = new Date(); in31.setDate(in31.getDate() + 31)
  const items: ({ date: string; plan: PlannedEvent } | { date: string; bond: BondEvent })[] = [
    ...upcoming(data.recurring, data.settings, today, 31).map(plan => ({ date: plan.date, plan })),
    ...bondEvents(data.trades, data.bonds, today, todayISO(in31), data.taxFree).map(bond => ({ date: bond.date, bond })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
  const [bondEvent, setBondEvent] = useState<BondEvent | null>(null)
  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const exportStale = data.txs.length > 0 && (data.settings.lastExportAt
    ? Date.now() - data.settings.lastExportAt > 7 * 864e5
    : !!data.settings.setupDismissed)
  const forecast = monthForecast(data, data.settings, today, r => data.toRub(r.amount, r.currency) ?? r.amount)
  const rate = savingsRate({ income: forecast.income, expense: forecast.expense })

  return (
    <div className="page air">
      <div className="air-head">
        <span>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <button className="icon-btn" aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'} onClick={() => setAmountsHidden(!hidden)}>
          <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} stroke={1.6} />
        </button>
      </div>

      <div className="air-balance glass">
        <span className="k">Общий баланс</span>
        <span className="big"><Money v={total} round /></span>
        {!hidden && delta !== 0 && (
          <span className={`delta ${delta > 0 ? 'pos' : 'neg'}`}>{delta > 0 ? '↑' : '↓'} {formatMoney(Math.round(Math.abs(delta) / 100) * 100)} за 30 дней</span>
        )}
        {homeAccounts.map(a => (
          <span className="air-acc" key={a.id}>
            <AccountDot color={data.colorOf(a)} /><span className="n">{a.name}</span>
            <span className="num"><Money v={data.value.get(a.id!) ?? 0} cur={a.currency} round /></span>
          </span>
        ))}
        <button className="pill-btn" onClick={onOpenAccounts}>Все счета <Icon name="right" size={14} /></button>
      </div>

      {(pending.length > 0 || data.pendingBond.length > 0 || exportStale) && (
        <div className="air-notices glass">
          {pending.map(t => (
            <button className="air-notice" key={t.id} onClick={() => onDistribute(t)}>
              <span>Пришло: {INCOME_LABEL[t.incomeKind!].toLowerCase()} <Money v={t.rub} round /> — распределить</span><Icon name="right" size={16} />
            </button>
          ))}
          {data.pendingBond.slice(0, 3).map(ev => (
            <button className="air-notice" key={ev.key} onClick={() => setBondEvent(ev)}>
              <span>{ev.kind === 'coupon' ? 'Купон' : 'Погашение'} {ev.shortName}{ev.amount != null && <> — <Money v={ev.amount} round /></>} — записать</span><Icon name="right" size={16} />
            </button>
          ))}
          {exportStale && (
            <button className="air-notice warn" onClick={onOpenBackup}>
              <span>{data.settings.lastExportAt ? 'Бэкапа не было больше недели' : 'Бэкап ещё не делался'}</span><Icon name="right" size={16} />
            </button>
          )}
        </div>
      )}

      <div className="air-section glass">
        <div className="air-stats">
          <button onClick={() => onOpenAnalytics('income')}>
            <span className="k">Доходы</span><span className="v pos"><Money v={totals.income} round /></span>
          </button>
          <button onClick={() => onOpenAnalytics('expense')}>
            <span className="k">Расходы</span><span className="v neg"><Money v={totals.expense} round /></span>
          </button>
        </div>
        {(totals.income > 0 || totals.expense > 0) && (
          <button className={`air-forecast ${forecast.balance < 0 ? 'bad' : ''}`} onClick={onOpenBudget}>
            <span>
              {forecast.balance < 0 ? 'Месяц уходит в минус' : 'К концу месяца останется'}{' '}
              <strong className={forecast.balance < 0 ? 'neg' : ''}>≈ <Money v={forecast.balance} round /></strong>
            </span>
            {rate != null && <span className="muted">сбережения ≈ {Math.round(rate * 100)}%</span>}
          </button>
        )}
      </div>

      <div className="air-section glass tight">
        <div className="air-title" style={{ paddingTop: 12 }}><span>Ближайшие платежи</span><button className="link" onClick={onOpenCalendar}>Все</button></div>
        {items.length === 0 && <p className="hint">Добавь аренду и кредит в «Ещё → Регулярные платежи».</p>}
        <div className="air-list">
          {items.map((it, i) => 'plan' in it ? <EventRow key={i} e={it.plan} data={data} today={today} thin /> : <BondEventRow key={i} e={it.bond} today={today} thin />)}
        </div>
      </div>
      {bondEvent && <BondEventSheet data={data} event={bondEvent} onClose={() => setBondEvent(null)} />}
    </div>
  )
}

function Lead({ icon, tone, thin }: { icon: IconName; tone: Bucket | 'income' | 'transfer'; thin?: boolean }) {
  if (!thin) return <Badge icon={icon} tone={tone} />
  return <span className="thin-ico"><Icon name={icon} size={22} stroke={1.6} /><i className={`tone-dot tone-${tone}`} /></span>
}

export function BondEventRow({ e, today, thin }: { e: BondEvent; today: string; thin?: boolean }) {
  return (
    <div className="row">
      <Lead icon="percent" tone="income" thin={thin} />
      <div className="body">
        <div className="title">{e.kind === 'coupon' ? 'Купон' : 'Погашение'} {e.shortName}</div>
        <div className="sub">{[shortDate(e.date), inDays(e.date, today), `${e.qty} шт.`].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="amt pos">{e.amount != null ? <>{e.estimated ? '≈ ' : ''}+<Money v={e.amount} round /></> : <span className="muted small">не объявлен</span>}</div>
    </div>
  )
}

export function EventRow({ e, data, today, thin }: { e: PlannedEvent; data: Data; today: string; thin?: boolean }) {
  if (e.kind === 'payment') {
    const r = e.recurring
    const cat = data.categories.find(c => c.id === r.categoryId)
    const root = cat?.parentId != null ? data.categories.find(c => c.id === cat.parentId) : cat
    return (
      <div className="row">
        <Lead icon={categoryIcon(root)} tone={cat?.bucket ?? root?.bucket ?? 'needs'} thin={thin} />
        <div className="body">
          <div className="title">{r.name}</div>
          <div className="sub">{[shortDate(e.date), inDays(e.date, today)].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="amt"><Money v={r.amount} cur={r.currency} /></div>
      </div>
    )
  }
  return (
    <div className="row">
      <Lead icon="banknote" tone="income" thin={thin} />
      <div className="body">
        <div className="title">{e.kind === 'salary' ? 'Зарплата' : 'Аванс'}</div>
        <div className="sub">{[shortDate(e.date), inDays(e.date, today)].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="amt pos">{e.amount ? <>+<Money v={e.amount} /></> : <span className="muted small">ожидается</span>}</div>
    </div>
  )
}
