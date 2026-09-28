import { useMemo, useState } from 'react'
import { db } from '../db'
import { allocationOf, suggestDistribution } from '../domain/calc'
import { formatMoney, monthOf } from '../domain/money'
import { BUCKET_LABEL, BUCKETS, INCOME_LABEL, REGULAR_INCOME, type Bucket, type Tx } from '../domain/types'
import { AmountInput, fromInput, Money, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'

const dayLabel = (d: number) => `${d}-го`

export function Distribute({ data, tx, onClose }: { data: Data; tx: Tx; onClose: () => void }) {
  const d = useMemo(() => suggestDistribution(
    tx,
    { txs: data.txs, allocations: data.allocations, recurring: data.recurring, goals: data.goals, goalRemainingRub: data.goalRemainingRub },
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

  const accept = useOnce(async () => {
    await db.allocations.where('txId').equals(tx.id!).delete()
    await db.allocations.add({ txId: tx.id!, month: monthOf(tx.date), ...allocationOf(d, parsed) })
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
              <span>{r.recurring.name} <span className="muted">· {dayLabel(r.recurring.day)}</span></span>
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

      {d.goalSuggestions.length > 0 && (
        <div className="card">
          <h3>Сбережения — куда</h3>
          {d.goalSuggestions.map(s => (
            <div className="line" key={s.goal.id}>
              <span>{s.goal.name} <span className="muted">→ {data.accounts.find(a => a.id === s.goal.accountId)?.name}</span></span>
              <Money v={s.rub} />
            </div>
          ))}
          <p className="hint">Переведи на эти счета — прогресс целей считается по реальному балансу.</p>
        </div>
      )}

      <button className="primary" onClick={accept}>Принять</button>
    </Sheet>
  )
}
