import { useMemo, useState } from 'react'
import { db } from '../db'
import { allocationOf, suggestDistribution, suggestGoals, transfersFor } from '../domain/calc'
import { formatMoney, monthOf, todayISO } from '../domain/money'
import { BUCKET_LABEL, BUCKETS, INCOME_LABEL, REGULAR_INCOME, type Bucket, type Tx } from '../domain/types'
import { AmountInput, fromInput, Money, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'

const dayLabel = (d: number) => `${d}-го`

export function Distribute({ data, tx, onClose }: { data: Data; tx: Tx; onClose: () => void }) {
  const d = useMemo(() => suggestDistribution(
    tx,
    {
      txs: data.txs, allocations: data.allocations, recurring: data.recurring, goals: data.goals, categories: data.categories,
      goalRemainingRub: data.goalRemainingRub, goalMonthLeftRub: data.goalMonthLeftRub,
    },
    data.settings,
    r => data.toRub(r.amount, r.currency) ?? 0,
  ), [tx, data])
  const [split, setSplit] = useState<Record<Bucket, string>>({
    needs: toInput(d.split.needs), wants: toInput(d.split.wants), savings: toInput(d.split.savings),
  })

  const reserved = d.reserves.reduce((s, r) => s + r.rub, 0)
  const parsed = { needs: fromInput(split.needs) ?? 0, wants: fromInput(split.wants) ?? 0, savings: fromInput(split.savings) ?? 0 }
  const rest = d.income - reserved - parsed.needs - parsed.wants - parsed.savings
  const kind = tx.incomeKind!
  const acc = data.accounts.find(a => a.id === tx.accountId)
  // Цели пересчитываются, если сумму сбережений поправили вручную.
  const goals = suggestGoals(parsed.savings, data.goals, data.goalRemainingRub, data.goalMonthLeftRub)
  const transfers = transfersFor({ ...d, goalSuggestions: goals }, tx.accountId)
    .filter(t => data.accounts.find(a => a.id === t.accountId)?.currency === acc?.currency)
  const [makeTransfers, setMakeTransfers] = useState(true)

  const accept = useOnce(async () => {
    await db.transaction('rw', db.allocations, db.txs, async () => {
      await db.allocations.where('txId').equals(tx.id!).delete()
      await db.allocations.add({ txId: tx.id!, month: monthOf(tx.date), ...allocationOf(d, parsed) })
      if (makeTransfers && transfers.length) {
        const date = todayISO() < tx.date ? tx.date : todayISO()
        await db.txs.bulkAdd(transfers.map((t, i) => ({
          date, type: 'transfer' as const, accountId: tx.accountId, toAccountId: t.accountId,
          amount: t.rub, rub: t.rub, toAmount: t.rub, toRub: t.rub, comment: t.reasons.join(', '), createdAt: Date.now() + i,
        })))
      }
    })
    onClose()
  })

  return (
    <Sheet title={`${INCOME_LABEL[kind]}: ${formatMoney(tx.amount, acc?.currency)}`} onClose={onClose}>
      {!REGULAR_INCOME.includes(kind) && (
        <p className="hint">Нерегулярный доход не входит в базу 50/30/20. По умолчанию — целиком в сбережения, поменяй, если нужно.</p>
      )}
      {d.reserves.length > 0 && (
        <div className="card">
          <h3>Сначала резерв</h3>
          {d.reserves.map(r => (
            <div className="line" key={r.recurring.id}>
              <span>{r.recurring.name} <span className="muted">· {r.recurring.kind === 'topup' ? 'пополнение' : dayLabel(r.recurring.day)}{r.recurring.fundFrom === 'both' ? ', половина' : ''}</span></span>
              <Money v={r.rub} />
            </div>
          ))}
          <p className="hint">Не трать эти деньги — они под обязательные платежи.</p>
        </div>
      )}

      <div className="card">
        <h3>Остальное</h3>
        {BUCKETS.map(b => (
          <div className="line input-line" key={b}>
            <span>{BUCKET_LABEL[b]}</span>
            <AmountInput value={split[b]} onChange={v => setSplit(s => ({ ...s, [b]: v }))} suffix="₽" />
          </div>
        ))}
        {rest !== 0 && (
          <p className={rest < 0 ? 'error' : 'hint'}>
            {rest > 0 ? `Не распределено: ${formatMoney(rest)}` : `Распределено больше поступления на ${formatMoney(-rest)}`}
          </p>
        )}
        {REGULAR_INCOME.includes(kind) && (
          <p className="hint">Суммы подобраны так, чтобы месяц целиком пришёл к {data.settings.rule.needs}/{data.settings.rule.wants}/{data.settings.rule.savings}, с учётом уже распределённого.</p>
        )}
      </div>

      {transfers.length > 0 ? (
        <div className="card">
          <h3>Разложить по копилкам</h3>
          {transfers.map(t => (
            <div className="line" key={t.accountId}>
              <span>→ {data.accounts.find(a => a.id === t.accountId)?.name} <div className="muted small">{t.reasons.join(', ')}</div></span>
              <Money v={t.rub} />
            </div>
          ))}
          <label className="check">
            <input type="checkbox" checked={makeTransfers} onChange={e => setMakeTransfers(e.target.checked)} />
            Записать эти переводы с «{acc?.name}»
          </label>
          <p className="hint">Сами деньги переведи в банке — приложение только запишет переводы, чтобы балансы совпадали.</p>
        </div>
      ) : goals.length > 0 || d.reserves.length > 0 ? (
        <p className="hint">Совет: укажи копилку у регулярных платежей («Ещё → Регулярные платежи»), и приложение будет само раскладывать резервы по счетам.</p>
      ) : null}

      <button className="save" onClick={accept}>{makeTransfers && transfers.length ? `Принять и записать переводы (${transfers.length})` : 'Принять'}</button>
    </Sheet>
  )
}
