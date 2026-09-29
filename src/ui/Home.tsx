import { bucketStates, monthAverage, monthTotals, netChangeSince, upcoming, type PlannedEvent } from '../domain/calc'
import { formatMoney, monthOf, todayISO } from '../domain/money'
import { BUCKET_LABEL, BUCKETS, INCOME_LABEL, type Tx } from '../domain/types'
import { Bar, Money, setAmountsHidden, useAmountsHidden } from './common'
import { activeAccounts, txView, type Data } from './data'
import { Badge, categoryIcon, Icon } from './icons'

const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function inDays(date: string, today: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 864e5)
  if (n < 0) return ''
  return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`
}

export function Home({ data, onDistribute, onOpenBudget, onOpenCalendar, onOpenBackup, onOpenTx }: {
  data: Data
  onDistribute: (t: Tx) => void
  onOpenBudget: () => void
  onOpenCalendar: () => void
  onOpenBackup: () => void
  onOpenTx: (t: Tx) => void
}) {
  const hidden = useAmountsHidden()
  const today = todayISO()
  const month = monthOf(today)
  const accounts = activeAccounts(data.accounts)
  const total = accounts.reduce((s, a) => s + (data.toRub(data.bal.get(a.id!) ?? 0, a.currency) ?? 0), 0)
  const since = new Date(); since.setDate(since.getDate() - 29)
  const delta = netChangeSince(data.txs, todayISO(since))
  const totals = monthTotals(data.txs, month)
  const avg = monthAverage(data.txs, month)
  const buckets = bucketStates(data, month, data.settings)
  const events = upcoming(data.recurring, data.settings, today, 31).slice(0, 5)
  const allocated = new Set(data.allocations.map(a => a.txId))
  const pending = data.txs.filter(t => t.type === 'income' && monthOf(t.date) === month && !allocated.has(t.id!))
  const exportStale = data.txs.length > 0 && (!data.settings.lastExportAt || Date.now() - data.settings.lastExportAt > 7 * 864e5)
  const recent = [...data.txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 4)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted small">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>Финансы</h1>
        </div>
      </div>

      {pending.map(t => (
        <button className="banner accent-b" key={t.id} onClick={() => onDistribute(t)}>
          <Badge icon="banknote" tone="income" size={34} />
          <span className="body">Пришло: {INCOME_LABEL[t.incomeKind!].toLowerCase()} <strong><Money v={t.rub} /></strong>. Распределить?</span>
          <Icon name="right" size={18} />
        </button>
      ))}
      {exportStale && (
        <button className="banner warn-b" onClick={onOpenBackup}>
          <span className="badge" style={{ width: 34, height: 34, color: 'var(--warn)' }}><Icon name="download" size={18} /></span>
          <span className="body">{data.settings.lastExportAt ? 'Бэкапа не было больше недели' : 'Бэкап ещё не делался'} — сохрани Excel в iCloud</span>
          <Icon name="right" size={18} />
        </button>
      )}

      <div className="card hero">
        <div className="label">
          <span>Общий баланс</span>
          <button className="icon-btn" aria-label={hidden ? 'Показать суммы' : 'Скрыть суммы'} onClick={() => setAmountsHidden(!hidden)}>
            <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} />
          </button>
        </div>
        <div className="big"><Money v={total} round /></div>
        {!hidden && delta !== 0 && (
          <div className={`delta ${delta > 0 ? 'pos' : 'neg'}`}>
            {delta > 0 ? '↑' : '↓'} {formatMoney(Math.round(Math.abs(delta) / 100) * 100)} за 30 дней
          </div>
        )}
        <div className="tiles">
          <div className="tile">
            <div className="k">Доходы за месяц</div>
            <div className="v pos"><Money v={totals.income} round /></div>
            {avg && !hidden && <div className="muted small">ср. {formatMoney(Math.round(avg.income / 100) * 100)}</div>}
          </div>
          <div className="tile">
            <div className="k">Расходы за месяц</div>
            <div className="v neg"><Money v={totals.expense} round /></div>
            {avg && !hidden && <div className="muted small">ср. {formatMoney(Math.round(avg.expense / 100) * 100)}</div>}
          </div>
        </div>
      </div>

      <button className="card" style={{ display: 'block', width: '100%' }} onClick={onOpenBudget}>
        <div className="line" style={{ paddingTop: 0 }}>
          <h3>План месяца</h3>
          <span className="muted small">{data.settings.rule.needs}/{data.settings.rule.wants}/{data.settings.rule.savings}</span>
        </div>
        {BUCKETS.map(b => {
          const s = buckets[b]
          return (
            <div key={b} style={{ marginTop: 8 }}>
              <div className="line small" style={{ padding: 0 }}>
                <span>{BUCKET_LABEL[b]}</span>
                <span className="num"><Money v={s.spent} round /> <span className="muted">/ <Money v={s.target} round /></span></span>
              </div>
              <Bar value={s.spent} max={s.target} color={`var(--${b})`} />
            </div>
          )
        })}
      </button>

      <div className="section-title">
        <h3>Ближайшие платежи</h3>
        <button className="link" onClick={onOpenCalendar}>Все</button>
      </div>
      <div className="card tight">
        {events.length === 0 && <p className="hint">Добавь аренду и кредит в «Ещё → Регулярные платежи».</p>}
        {events.map((e, i) => <EventRow key={i} e={e} data={data} today={today} />)}
      </div>

      {recent.length > 0 && (
        <>
          <div className="section-title"><h3>Последние операции</h3></div>
          <div className="card tight">
            {recent.map(t => {
              const v = txView(data, t)
              const acc = data.accounts.find(a => a.id === t.accountId)
              return (
                <button className="row" key={t.id} onClick={() => onOpenTx(t)}>
                  <Badge icon={v.icon} tone={v.tone} />
                  <div className="body"><div className="title">{v.title}</div><div className="sub">{v.sub}</div></div>
                  <div className={`amt ${t.type === 'income' ? 'pos' : ''}`}>
                    {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}<Money v={t.amount} cur={acc?.currency} />
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export function EventRow({ e, data, today }: { e: PlannedEvent; data: Data; today: string }) {
  if (e.kind === 'payment') {
    const r = e.recurring
    const cat = data.categories.find(c => c.id === r.categoryId)
    const root = cat?.parentId != null ? data.categories.find(c => c.id === cat.parentId) : cat
    return (
      <div className="row">
        <Badge icon={categoryIcon(root)} tone={root?.bucket ?? 'needs'} />
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
      <Badge icon="banknote" tone="income" />
      <div className="body">
        <div className="title">{e.kind === 'salary' ? 'Зарплата' : 'Аванс'}</div>
        <div className="sub">{[shortDate(e.date), inDays(e.date, today)].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="amt pos">{e.amount ? <>+<Money v={e.amount} /></> : <span className="muted small">ожидается</span>}</div>
    </div>
  )
}
