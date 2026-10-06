import { useRef, useState } from 'react'
import { db, saveSettings } from '../db'
import { balances } from '../domain/calc'
import { applyCoinKeeper, CkError, previewCoinKeeper, type CkPreview, type CkResult } from '../domain/coinkeeper'
import { INCOME_LABEL, type Bucket } from '../domain/types'
import { Money, useOnce } from './common'
import type { Data } from './data'
import { Icon } from './icons'

const dmy = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU')

export function ImportCk({ data, onDone }: { data: Data; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<CkPreview | null>(null)
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({})
  const [cleanup, setCleanup] = useState(true)
  const [result, setResult] = useState<CkResult | null>(null)
  const [error, setError] = useState('')

  async function pick(f: File) {
    setError('')
    try {
      const p = await previewCoinKeeper(db, await f.text())
      setPreview(p)
      setBuckets(Object.fromEntries(p.categories.map(c => [c.name, c.bucket])))
    } catch (e) {
      setError(e instanceof CkError ? e.message : 'Не получилось прочитать файл')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const run = useOnce(async () => {
    if (!preview) return
    const r = await applyCoinKeeper(db, preview, buckets)
    if (cleanup) await tidyUp()
    setResult(r)
  })

  /** Убирает пустые стандартные категории и пустой счёт по умолчанию; основным делает счёт с большинством трат. */
  async function tidyUp() {
    const [txs, cats, accs] = await Promise.all([db.txs.toArray(), db.categories.toArray(), db.accounts.toArray()])
    const usedCats = new Set(txs.map(t => t.categoryId))
    const usedRoots = new Set(cats.filter(c => usedCats.has(c.id)).map(c => c.parentId ?? c.id))
    const usedRecurring = new Set((await db.recurring.toArray()).map(r => r.categoryId))
    await db.transaction('rw', db.categories, db.accounts, async () => {
      for (const c of cats) {
        if (c.system || usedCats.has(c.id) || usedRecurring.has(c.id!)) continue
        if (c.parentId == null && usedRoots.has(c.id)) continue
        await db.categories.update(c.id!, { archived: true })
      }
      for (const a of accs) {
        const used = txs.some(t => t.accountId === a.id || t.toAccountId === a.id)
        if (!used && a.openingBalance === 0) await db.accounts.update(a.id!, { archived: true })
      }
    })
    const count = new Map<number, number>()
    for (const t of txs) if (t.type === 'expense') count.set(t.accountId, (count.get(t.accountId) ?? 0) + 1)
    const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (main != null) await saveSettings({ defaultAccountId: main })
  }

  if (result) {
    const accs = data.accounts.filter(a => result.accountIds.includes(a.id!))
    const bal = balances(data.accounts, data.txs)
    const total = accs.reduce((s, a) => s + (bal.get(a.id!) ?? 0), 0)
    return (
      <>
        <div className="card">
          <div className="line"><span>Перенесено операций</span><strong>{result.added}</strong></div>
          {result.duplicates > 0 && <div className="line"><span>Уже были — пропущено</span><strong>{result.duplicates}</strong></div>}
          <div className="line"><span>Новых счетов / категорий</span><strong>{result.accountsCreated} / {result.categoriesCreated}</strong></div>
        </div>
        <h3 style={{ margin: '16px 2px 8px' }}>Сверь балансы с CoinKeeper</h3>
        <div className="card tight">
          {accs.map(a => (
            <div className="row" key={a.id}>
              <div className="body title">{a.name}</div>
              <div className="amt"><Money v={bal.get(a.id!) ?? 0} cur={a.currency} /></div>
            </div>
          ))}
          <div className="row"><div className="body title">Итого</div><div className="amt"><Money v={total} /></div></div>
        </div>
        <p className="hint">Если какой-то счёт не совпадает — открой его в «Ещё → Счета и цели» и введи, сколько на нём сейчас.</p>
        <p className="hint">Дальше: укажи копилки у регулярных платежей (аренда → «Квартира», кредит → «Кредиты») в «Ещё → Регулярные платежи».</p>
        <button className="save" onClick={onDone}>Готово</button>
      </>
    )
  }

  if (!preview) {
    return (
      <>
        <p className="hint">Выгрузи операции из CoinKeeper в CSV за весь период (как ты уже делал) и сохрани файл в «Файлы» на iPhone. Потом выбери его здесь.</p>
        <p className="hint">Импорт можно повторять: уже перенесённые операции пропускаются, добавятся только новые.</p>
        <button className="save" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Выбрать CSV-файл</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && pick(e.target.files[0])} />
        {error && <p className="error">{error}</p>}
      </>
    )
  }

  const newAccounts = preview.accounts.filter(a => !a.exists)
  return (
    <>
      <div className="card">
        <div className="line"><span>Операций</span><strong>{preview.rows.length}</strong></div>
        <div className="line"><span>Период</span><span>{dmy(preview.from)} — {dmy(preview.to)}</span></div>
        {preview.unsupported > 0 && <p className="warn">{preview.unsupported} операций не в рублях — их пока пропущу.</p>}
      </div>

      <h3 style={{ margin: '16px 2px 8px' }}>Счета</h3>
      <div className="card">
        <div className="chips">
          {preview.accounts.map(a => <span className="chip" key={a.name}>{a.name}{!a.exists && <span className="muted small"> · новый</span>}</span>)}
        </div>
        {newAccounts.length > 0 && <p className="hint">Будет создано новых: {newAccounts.length}.</p>}
      </div>

      <h3 style={{ margin: '16px 2px 8px' }}>Категории</h3>
      <div className="card tight">
        {preview.categories.map(c => (
          <div className="row" key={c.name}>
            <div className="body">
              <div className="title">{c.name}</div>
              <div className="sub">{c.count} оп. · <Money v={c.rub} />{c.exists ? ' · уже есть' : ''}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ margin: '16px 2px 8px' }}>Доходы</h3>
      <div className="card tight">
        {preview.incomeSources.map(s => (
          <div className="row" key={s.name}>
            <div className="body title">{s.name}</div>
            <div className="amt muted small">→ {INCOME_LABEL[s.kind]} · {s.count}</div>
          </div>
        ))}
      </div>

      <label className="check">
        <input type="checkbox" checked={cleanup} onChange={e => setCleanup(e.target.checked)} />
        Скрыть пустые стандартные категории и счета
      </label>
      <button className="save" onClick={run}>Перенести {preview.rows.length} операций</button>
      <button className="secondary" onClick={() => setPreview(null)}>Выбрать другой файл</button>
    </>
  )
}
