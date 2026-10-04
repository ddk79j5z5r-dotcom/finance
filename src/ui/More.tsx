import { useEffect, useRef, useState } from 'react'
import { db, saveSettings } from '../db'
import { refreshLatestRate } from '../domain/rates'
import { BUCKET_LABEL, BUCKETS, CURRENCIES, type Bucket, type Category, type Currency, type Recurring } from '../domain/types'
import { disableLock, enrollFaceId, faceIdSupported, getLock, isLockEnabled, setPin } from '../lock'
import { AmountInput, Chips, CUR_SUFFIX, fromInput, Money, Sheet, toInput, useOnce } from './common'
import { childrenOf, rateHint, rootCategories, type Data } from './data'
import { Icon, type IconName } from './icons'
import { ImportCk } from './ImportCk'

export type MoreSection = 'rule' | 'pay' | 'categories' | 'recurring' | 'security' | 'backup' | 'reminders' | 'coinkeeper'
export type MorePage = 'calendar' | 'analytics' | 'accounts'

const PAGES: { id: MorePage; label: string; sub: string; icon: IconName }[] = [
  { id: 'calendar', label: 'Календарь', sub: 'платежи и выплаты по дням', icon: 'calendar' },
  { id: 'analytics', label: 'Аналитика', sub: 'структура и динамика', icon: 'chart' },
  { id: 'accounts', label: 'Счета и цели', sub: 'балансы, накопления', icon: 'wallet' },
]

const SECTIONS: { id: MoreSection; label: string; icon: IconName }[] = [
  { id: 'backup', label: 'Бэкап и Excel', icon: 'download' },
  { id: 'coinkeeper', label: 'Импорт из CoinKeeper', icon: 'upload' },
  { id: 'pay', label: 'Выплаты', icon: 'banknote' },
  { id: 'rule', label: 'Правило распределения', icon: 'sliders' },
  { id: 'recurring', label: 'Регулярные платежи', icon: 'repeat' },
  { id: 'categories', label: 'Категории', icon: 'tag' },
  { id: 'security', label: 'Face ID и PIN', icon: 'lock' },
  { id: 'reminders', label: 'Напоминания', icon: 'bell' },
]

export function More({ data, section, setSection, onOpenPage }: {
  data: Data; section: MoreSection | null; setSection: (s: MoreSection | null) => void; onOpenPage: (p: MorePage) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const r = data.latestRate
  return (
    <div className="page">
      <div className="page-head"><h1>Ещё</h1></div>
      <div className="card tight">
        {PAGES.map(p => (
          <button className="row" key={p.id} onClick={() => onOpenPage(p.id)}>
            <span className="badge" style={{ width: 40, height: 40, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={p.icon} size={20} /></span>
            <div className="body"><div className="title">{p.label}</div><div className="sub">{p.sub}</div></div>
            <span className="chev"><Icon name="right" size={18} /></span>
          </button>
        ))}
      </div>
      <div className="section-title"><h3>Настройки</h3></div>
      <div className="card tight">
        {SECTIONS.map(s => (
          <button className="row" key={s.id} onClick={() => setSection(s.id)}>
            <span className="badge" style={{ width: 34, height: 34, background: 'var(--card-2)', color: 'var(--text-2)' }}><Icon name={s.icon} size={18} /></span>
            <div className="body title">{s.label}</div>
            <span className="chev"><Icon name="right" size={18} /></span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="line" style={{ paddingTop: 0 }}>
          <h3>Курсы ЦБ</h3>
          <button className="link small" disabled={refreshing} onClick={async () => { setRefreshing(true); await refreshLatestRate(db); setRefreshing(false) }}>
            {refreshing ? 'Обновляю…' : 'Обновить'}
          </button>
        </div>
        {r ? (
          <>
            <div className="line"><span>USD</span><span className="num">{r.USD.toFixed(2)} ₽</span></div>
            <div className="line"><span>EUR</span><span className="num">{r.EUR.toFixed(2)} ₽</span></div>
            <div className="muted small">{rateHint(r)}</div>
          </>
        ) : <p className="hint">Курсов ещё нет — нужен интернет.</p>}
      </div>

      {section && (
        <Sheet title={SECTIONS.find(s => s.id === section)!.label} onClose={() => setSection(null)}>
          {section === 'rule' && <RuleSection data={data} onDone={() => setSection(null)} />}
          {section === 'pay' && <PaySection data={data} onDone={() => setSection(null)} />}
          {section === 'categories' && <CategoriesSection data={data} />}
          {section === 'recurring' && <RecurringSection data={data} />}
          {section === 'security' && <SecuritySection />}
          {section === 'backup' && <BackupSection data={data} />}
          {section === 'reminders' && <RemindersSection />}
          {section === 'coinkeeper' && <ImportCk data={data} onDone={() => setSection(null)} />}
        </Sheet>
      )}
    </div>
  )
}

function RuleSection({ data, onDone }: { data: Data; onDone: () => void }) {
  const [rule, setRule] = useState(data.settings.rule)
  const sum = rule.needs + rule.wants + rule.savings
  return (
    <>
      {BUCKETS.map(b => (
        <div className="line input-line" key={b}>
          <span>{BUCKET_LABEL[b]}</span>
          <div className="amount"><input inputMode="numeric" value={rule[b]} onChange={e => setRule(r => ({ ...r, [b]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} /><span className="suffix">%</span></div>
        </div>
      ))}
      {sum !== 100 && <p className="error">Сумма должна быть 100%, сейчас {sum}%</p>}
      <p className="hint">Считается на весь месяц: зарплата + аванс + премия. Переводы от родителей не входят.</p>
      <button className="save" disabled={sum !== 100} onClick={async () => { await saveSettings({ rule }); onDone() }}>Сохранить</button>
    </>
  )
}

function PaySection({ data, onDone }: { data: Data; onDone: () => void }) {
  const s = data.settings
  const [salaryDay, setSalaryDay] = useState(String(s.salaryDay))
  const [advanceDay, setAdvanceDay] = useState(String(s.advanceDay))
  const [salary, setSalary] = useState(toInput(s.expectedSalary))
  const [advance, setAdvance] = useState(toInput(s.expectedAdvance))
  const day = (v: string) => Math.min(31, Math.max(1, Number(v) || 1))
  return (
    <>
      <div className="row2">
        <div><label className="field-label">Зарплата, число</label><input inputMode="numeric" value={salaryDay} onChange={e => setSalaryDay(e.target.value)} /></div>
        <div><label className="field-label">Аванс, число</label><input inputMode="numeric" value={advanceDay} onChange={e => setAdvanceDay(e.target.value)} /></div>
      </div>
      <label className="field-label">Ожидаемая зарплата</label>
      <AmountInput value={salary} onChange={setSalary} suffix="₽" />
      <label className="field-label">Ожидаемый аванс</label>
      <AmountInput value={advance} onChange={setAdvance} suffix="₽" />
      <p className="hint">Нужно, чтобы план 50/30/20 был виден с начала месяца. Когда выплата придёт, в расчёт пойдёт фактическая сумма. Премию заранее не планируем.</p>
      <button className="save" onClick={async () => {
        await saveSettings({ salaryDay: day(salaryDay), advanceDay: day(advanceDay), expectedSalary: fromInput(salary) ?? 0, expectedAdvance: fromInput(advance) ?? 0 })
        onDone()
      }}>Сохранить</button>
    </>
  )
}

function CategoriesSection({ data }: { data: Data }) {
  const [edit, setEdit] = useState<Partial<Category> | null>(null)
  const roots = rootCategories(data.categories)
  return (
    <>
      {edit ? <CategoryForm data={data} cat={edit} onDone={() => setEdit(null)} /> : (
        <>
          {BUCKETS.map(b => (
            <div key={b}>
              <div className="day">{BUCKET_LABEL[b]}</div>
              <div className="card tight">
                {roots.filter(c => c.bucket === b).map(c => (
                  <div key={c.id}>
                    <button className="row" onClick={() => setEdit(c)}><span>{c.name}</span><span className="muted">›</span></button>
                    {childrenOf(data.categories, c.id!).map(s => (
                      <button className="row" style={{ paddingLeft: 20 }} key={s.id} onClick={() => setEdit(s)}><span>{s.name}</span><span className="muted">›</span></button>
                    ))}
                    <button className="link small" style={{ display: "block", padding: "4px 0 12px 20px" }} onClick={() => setEdit({ parentId: c.id!, bucket: c.bucket })}>+ подкатегория</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button className="secondary" onClick={() => setEdit({ parentId: null, bucket: 'wants' })}>+ Категория</button>
        </>
      )}
    </>
  )
}

function CategoryForm({ data, cat, onDone }: { data: Data; cat: Partial<Category>; onDone: () => void }) {
  const [name, setName] = useState(cat.name ?? '')
  const [bucket, setBucket] = useState<Bucket>(cat.bucket ?? 'wants')
  const isSub = cat.parentId != null
  const save = useOnce(async () => {
    if (!name.trim()) return
    await db.transaction('rw', db.categories, async () => {
      const id = await db.categories.put({ ...(cat as Category), name: name.trim(), bucket, parentId: cat.parentId ?? null, archived: cat.archived ?? false })
      // тип подкатегорий всегда совпадает с родителем
      if (!isSub) for (const c of childrenOf(data.categories, id!)) await db.categories.update(c.id!, { bucket })
    })
    onDone()
  })
  const archive = useOnce(async () => {
    if (!confirm('Скрыть категорию? Прошлые операции сохранятся.')) return
    await db.categories.update(cat.id!, { archived: true })
    onDone()
  })
  return (
    <>
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      {!isSub && (
        <>
          <label className="field-label">Тип</label>
          <Chips options={(['needs', 'wants'] as Bucket[]).map(b => ({ value: b, label: BUCKET_LABEL[b] }))} value={bucket} onChange={setBucket} />
        </>
      )}
      <button className="save" onClick={save}>Сохранить</button>
      {cat.id && <button className="danger" onClick={archive}>Скрыть</button>}
      <button className="secondary" onClick={onDone}>Назад</button>
    </>
  )
}

function RecurringSection({ data }: { data: Data }) {
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null)
  if (edit) return <RecurringForm data={data} r={edit} onDone={() => setEdit(null)} />
  return (
    <>
      <div className="card tight">
        {[...data.recurring].sort((a, b) => a.day - b.day).map(r => (
          <button className="row" key={r.id} onClick={() => setEdit(r)}>
            <span className={r.active ? '' : 'muted'}>{r.day}-го · {r.name}<div className="muted small">из {r.fundFrom === 'salary' ? 'зарплаты' : 'аванса'}</div></span>
            <Money v={r.amount} cur={r.currency} />
          </button>
        ))}
        {data.recurring.length === 0 && <p className="hint">Например: аренда 1-го из зарплаты, кредит 29-го из аванса.</p>}
      </div>
      <button className="secondary" onClick={() => setEdit({ currency: 'RUB', fundFrom: 'salary', active: true })}>+ Платёж</button>
    </>
  )
}

function RecurringForm({ data, r, onDone }: { data: Data; r: Partial<Recurring>; onDone: () => void }) {
  const [name, setName] = useState(r.name ?? '')
  const [amount, setAmount] = useState(toInput(r.amount))
  const [currency, setCurrency] = useState<Currency>(r.currency ?? 'RUB')
  const [day, setDay] = useState(String(r.day ?? 1))
  const [categoryId, setCategoryId] = useState<number | undefined>(r.categoryId)
  const [fundFrom, setFundFrom] = useState(r.fundFrom ?? 'salary')
  const [active, setActive] = useState(r.active ?? true)
  const [reserveAccountId, setReserveAccountId] = useState<number | null>(r.reserveAccountId ?? null)
  const cats = data.categories.filter(c => !c.archived && !c.system)
  const label = (c: Category) => (c.parentId != null ? `${data.categories.find(p => p.id === c.parentId)?.name} · ${c.name}` : c.name)

  const save = useOnce(async () => {
    const a = fromInput(amount)
    if (!name.trim() || !a || categoryId == null) return
    await db.recurring.put({ ...(r as Recurring), name: name.trim(), amount: a, currency, day: Math.min(31, Math.max(1, Number(day) || 1)), categoryId, fundFrom, reserveAccountId, active })
    onDone()
  })
  return (
    <>
      <label className="field-label">Название</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Аренда" autoFocus={!r.id} />
      <label className="field-label">Сумма</label>
      <AmountInput value={amount} onChange={setAmount} suffix={CUR_SUFFIX[currency]} />
      <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
      <label className="field-label">Число месяца</label>
      <input inputMode="numeric" value={day} onChange={e => setDay(e.target.value)} />
      <label className="field-label">Категория</label>
      <select value={categoryId ?? ''} onChange={e => setCategoryId(Number(e.target.value))}>
        <option value="" disabled>Выбери</option>
        {cats.sort((a, b) => label(a).localeCompare(label(b))).map(c => <option key={c.id} value={c.id}>{label(c)}</option>)}
      </select>
      <label className="field-label">Резервировать из</label>
      <Chips options={[{ value: 'salary' as const, label: `Зарплаты (${data.settings.salaryDay}-го)` }, { value: 'advance' as const, label: `Аванса (${data.settings.advanceDay}-го)` }]} value={fundFrom} onChange={setFundFrom} />
      <label className="field-label">Копилка для этого платежа</label>
      <select value={reserveAccountId ?? ''} onChange={e => setReserveAccountId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Нет — деньги остаются на основном счёте</option>
        {data.accounts.filter(a => !a.archived && a.currency === currency).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <p className="hint">Например, «Квартира» для аренды. При распределении зарплаты приложение предложит перевести резерв на этот счёт, а «Оплатил» спишет платёж с него.</p>
      <label className="check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Активен</label>
      <button className="save" onClick={save}>Сохранить</button>
      {r.id && <button className="danger" onClick={async () => { if (confirm('Удалить платёж?')) { await db.recurring.delete(r.id!); onDone() } }}>Удалить</button>}
      <button className="secondary" onClick={onDone}>Назад</button>
    </>
  )
}

function SecuritySection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [hasFaceId, setHasFaceId] = useState(false)
  const [pin, setPinValue] = useState('')
  const [msg, setMsg] = useState('')
  const load = async () => {
    const l = await getLock()
    setEnabled(isLockEnabled(l))
    setHasFaceId(!!l.credentialId)
  }
  useEffect(() => { load() }, [])
  if (enabled === null) return null

  async function savePin() {
    if (!/^\d{6}$/.test(pin)) return setMsg('PIN — ровно 6 цифр')
    await setPin(pin)
    setPinValue('')
    setMsg('PIN сохранён')
    load()
  }
  async function faceId() {
    try {
      await enrollFaceId()
      setMsg('Face ID включён')
      load()
    } catch {
      setMsg('Не получилось включить Face ID')
    }
  }

  return (
    <>
      <p className="hint">Замок на вход в приложение. Сначала задай запасной PIN из 6 цифр, потом включи Face ID.</p>
      <label className="field-label">{enabled ? 'Сменить PIN' : 'Задать PIN'}</label>
      <input inputMode="numeric" type="password" maxLength={6} value={pin} onChange={e => setPinValue(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
      <button className="save" onClick={savePin}>Сохранить PIN</button>
      {enabled && faceIdSupported() && (
        <button className="secondary" onClick={faceId}>{hasFaceId ? 'Перенастроить Face ID' : 'Включить Face ID'}</button>
      )}
      {enabled && <button className="danger" onClick={async () => { if (confirm('Отключить замок?')) { await disableLock(); load() } }}>Отключить замок</button>}
      {msg && <p className="hint">{msg}</p>}
    </>
  )
}

function BackupSection({ data }: { data: Data }) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const last = data.settings.lastExportAt

  async function doExport() {
    setBusy('export'); setMsg('')
    try {
      const { exportWorkbook } = await import('../domain/excel')
      const buf = await exportWorkbook(db)
      const name = `finance-${new Date().toISOString().slice(0, 10)}.xlsx`
      const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          throw e
        }
      } else {
        const url = URL.createObjectURL(file)
        const a = Object.assign(document.createElement('a'), { href: url, download: name })
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      await saveSettings({ lastExportAt: Date.now() })
      setMsg('Готово')
    } catch {
      setMsg('Не получилось выгрузить файл')
    } finally {
      setBusy('')
    }
  }

  async function doImport(f: File) {
    if (!confirm('Все текущие данные в приложении будут заменены данными из файла. Продолжить?')) return
    setBusy('import'); setMsg('')
    const { ImportError, importWorkbook } = await import('../domain/excel')
    try {
      const res = await importWorkbook(db, await f.arrayBuffer())
      setMsg(`Восстановлено: ${res.txs} операций`)
    } catch (e) {
      setMsg(e instanceof ImportError ? e.message : 'Не получилось прочитать файл')
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <p className="hint">
        Данные хранятся только в этом телефоне. Удалишь иконку с экрана «Домой» — удалятся и они.
        Один Excel-файл — это и бэкап, и таблица для анализа на Mac.
      </p>
      <p className="hint">Последний бэкап: {last ? new Date(last).toLocaleString('ru-RU') : 'не было'}</p>
      <button className="save" disabled={!!busy} onClick={doExport}>{busy === 'export' ? 'Готовлю файл…' : 'Выгрузить в Excel'}</button>
      <p className="hint">В меню «Поделиться» выбери «Сохранить в Файлы» → iCloud Drive.</p>
      <button className="secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'import' ? 'Восстанавливаю…' : 'Восстановить из файла'}</button>
      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => e.target.files?.[0] && doImport(e.target.files[0])} />
      {msg && <p className="hint"><strong>{msg}</strong></p>}
    </>
  )
}

function RemindersSection() {
  return (
    <>
      <p className="hint">
        Веб-приложения на iPhone не умеют сами присылать уведомления по расписанию. Напоминание в 21:00 настраивается
        один раз через приложение «Команды»:
      </p>
      <ol className="steps">
        <li>Открой «Команды» → вкладка «Автоматизация» → «+».</li>
        <li>«Время суток» → 21:00, «Ежедневно» → «Запускать сразу».</li>
        <li>«Новая пустая автоматизация» → добавь действие «Показать уведомление».</li>
        <li>Текст: «Внеси траты за сегодня».</li>
      </ol>
      <p className="hint">Напоминание о бэкапе приложение показывает само — баннером на экране «Месяц», если бэкапа не было больше недели.</p>
    </>
  )
}
