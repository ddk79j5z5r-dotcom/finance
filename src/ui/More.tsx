import { useEffect, useRef, useState } from 'react'
import { db, saveSettings } from '../db'
import { refreshLatestRate } from '../domain/rates'
import { CURRENCIES, type Category, type Currency, type Recurring } from '../domain/types'
import { disableLock, enrollFaceId, faceIdSupported, getLock, isLockEnabled, setPin } from '../lock'
import { AmountInput, Bar, Chips, CUR_SUFFIX, fromInput, Money, Section, Sheet, toInput, useOnce } from './common'
import { plural } from '../domain/money'
import { setupSteps } from '../domain/calc'
import { rateHint, type Data } from './data'
import { Icon, type IconName } from './icons'
import { Payouts } from './Payouts'
import { notify } from './undo'

export type MoreSection = 'pay' | 'tags' | 'recurring' | 'security' | 'backup' | 'reminders'
export type MorePage = 'calendar' | 'analytics' | 'accounts' | 'goals' | 'invest' | 'categories' | 'plan'

const SECTIONS: { id: MoreSection; label: string; icon: IconName }[] = [
  { id: 'backup', label: 'Бэкап и Excel', icon: 'download' },
  { id: 'pay', label: 'Выплаты', icon: 'banknote' },
  { id: 'recurring', label: 'Регулярные платежи', icon: 'repeat' },
  { id: 'tags', label: 'Метки', icon: 'tag' },
  { id: 'security', label: 'Face ID и PIN', icon: 'lock' },
  { id: 'reminders', label: 'Напоминания', icon: 'bell' },
]

/** Строка меню: цветной квадратный значок, название, короткая подсказка о содержимом. */
function MenuRow({ icon, color, label, sub, onClick }: { icon: IconName; color: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <button className="row" onClick={onClick}>
      <span className="menu-ico" style={{ background: color }}><Icon name={icon} size={16} /></span>
      <span className="body"><span className="title">{label}</span>{sub && <span className="sub">{sub}</span>}</span>
      <Icon name="right" size={16} />
    </button>
  )
}

export function More({ data, section, setSection, onOpenPage }: {
  data: Data; section: MoreSection | null; setSection: (s: MoreSection | null) => void; onOpenPage: (p: MorePage) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const r = data.latestRate
  const steps = setupSteps(data, data.lockEnabled)
  const stepsDone = steps.filter(x => x.done).length
  const accounts = data.accounts.filter(a => !a.archived)
  const brokers = accounts.filter(a => data.trades.some(t => t.accountId === a.id) || a.kind === 'broker')
  const positions = data.bondPositions.filter(p => p.qty > 0)
  const today = new Date().toISOString().slice(0, 10)
  const nextCoupon = data.bonds.flatMap(b => b.coupons.filter(c => c.date >= today).slice(0, 1).map(c => c.date)).sort()[0]
  const recurring = data.recurring.filter(x => x.active)
  const backupAgo = data.settings.lastExportAt ? Math.floor((Date.now() - data.settings.lastExportAt) / 864e5) : null
  return (
    <div className="page">
      <div className="page-head"><h1>Ещё</h1></div>
      {!data.settings.setupDismissed && stepsDone < steps.length && (
        <div className="card setup">
          <div className="line" style={{ paddingTop: 0 }}>
            <h3>Настрой приложение · {stepsDone} из {steps.length}</h3>
            <button className="icon-btn" aria-label="Скрыть" onClick={() => saveSettings({ setupDismissed: true })}><Icon name="close" size={16} /></button>
          </div>
          <Bar value={stepsDone} max={steps.length} color="var(--accent)" />
          {steps.map(st => (
            <button key={st.id} className={`setup-step ${st.done ? 'done' : ''}`} disabled={st.done}
              onClick={() => (st.id === 'goals' ? onOpenPage('goals') : setSection(st.id))}>
              <span className="check-circle">{st.done && <Icon name="check" size={12} />}</span>
              <span className="body">{st.label}</span>
              {!st.done && <Icon name="right" size={14} />}
            </button>
          ))}
        </div>
      )}

      <Section title="Деньги" />
      <div className="list">
        <MenuRow icon="wallet" color="#2f6fed" label="Счета" sub={`${accounts.length} ${plural(accounts.length, ['счёт', 'счёта', 'счетов'])}`} onClick={() => onOpenPage('accounts')} />
        <MenuRow icon="target" color="#21a038" label="Цели" sub={data.goals.length ? `${data.goals.length} ${plural(data.goals.length, ['цель', 'цели', 'целей'])}` : 'ещё нет — задаются у копилки'} onClick={() => onOpenPage('goals')} />
        {brokers.length > 0 && <MenuRow icon="percent" color="#7a5ae0" label="Инвестиции" sub={`${positions.length} ${plural(positions.length, ['облигация', 'облигации', 'облигаций'])}${nextCoupon ? ` · купон ${new Date(nextCoupon + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}`} onClick={() => onOpenPage('invest')} />}
      </div>

      <Section title="Планирование" />
      <div className="list">
        <MenuRow icon="calendar" color="#e09a1f" label="Календарь" sub="платежи, выплаты, купоны" onClick={() => onOpenPage('calendar')} />
        <MenuRow icon="repeat" color="#2a9d8f" label="План платежей" sub={recurring.length ? recurring.map(x => x.name).slice(0, 3).join(', ') : 'аренда, кредит, подписки'} onClick={() => onOpenPage('plan')} />
        <MenuRow icon="banknote" color="#21a038" label="Выплаты" sub={`зарплата ${data.settings.salaryDay}-го, аванс ${data.settings.advanceDay}-го`} onClick={() => setSection('pay')} />
      </div>

      <Section title="Анализ" />
      <div className="list">
        <MenuRow icon="chart" color="#d6487a" label="Аналитика" sub="доходы и расходы, категории, капитал" onClick={() => onOpenPage('analytics')} />
      </div>

      <Section title="Данные" />
      <div className="list">
        <MenuRow icon="download" color="#5d626d" label="Бэкап и Excel" sub={backupAgo == null ? 'бэкапа ещё не было' : backupAgo === 0 ? 'бэкап сегодня' : `бэкап ${backupAgo} ${plural(backupAgo, ['день', 'дня', 'дней'])} назад`} onClick={() => setSection('backup')} />
      </div>

      <Section title="Настройки" />
      <div className="list">
        <MenuRow icon="tag" color="#e0782f" label="Категории" sub={`${data.categories.filter(c => !c.archived && !c.system && (c.kind ?? 'expense') === 'expense').length} расходов · ${data.categories.filter(c => !c.archived && c.kind === 'income').length} доходов`} onClick={() => onOpenPage('categories')} />
        <MenuRow icon="tag" color="#5d626d" label="Метки" sub={(data.settings.tags ?? []).map(t => `#${t}`).slice(0, 3).join(' ') || 'нет'} onClick={() => setSection('tags')} />
        <MenuRow icon="lock" color="#5d626d" label="Face ID и PIN" sub={data.lockEnabled ? 'включено' : 'выключено'} onClick={() => setSection('security')} />
        <MenuRow icon="bell" color="#5d626d" label="Напоминания" onClick={() => setSection('reminders')} />
      </div>

      <Section title="Курсы ЦБ" extra={<button className="link" disabled={refreshing} onClick={async () => { setRefreshing(true); await refreshLatestRate(db); setRefreshing(false) }}>{refreshing ? 'Обновляю…' : 'Обновить'}</button>} />
      <div className="list">
        {r ? (
          <>
            <div className="row noic" style={{ padding: '0.4rem 0.82rem' }}><span className="body">Доллар США</span><span className="num">{r.USD.toFixed(2)} ₽</span></div>
            <div className="row noic" style={{ padding: '0.4rem 0.82rem' }}><span className="body">Евро</span><span className="num">{r.EUR.toFixed(2)} ₽</span></div>
          </>
        ) : <p className="hint" style={{ padding: '0.5rem 0.82rem', margin: 0 }}>Курсов ещё нет — нужен интернет.</p>}
      </div>
      <p className="hint">{rateHint(r)} — по нему валютные счета переводятся в рубли.</p>
      <p className="hint" style={{ textAlign: 'center', marginTop: '1.2rem' }}>Версия от {new Date(__BUILD_TIME__).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>

      {section && (
        <Sheet title={SECTIONS.find(s => s.id === section)!.label} onClose={() => setSection(null)}>
          {section === 'pay' && <Payouts data={data} onDone={() => setSection(null)} />}
          {section === 'tags' && <TagsSection data={data} />}
          {section === 'recurring' && <RecurringSection data={data} />}
          {section === 'security' && <SecuritySection />}
          {section === 'backup' && <BackupSection data={data} />}
          {section === 'reminders' && <RemindersSection />}
        </Sheet>
      )}
    </div>
  )
}

/** Метки операций: несколько на одну операцию, фильтр в истории и аналитике. */
function TagsSection({ data }: { data: Data }) {
  const tags = data.settings.tags ?? []
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const used = (t: string) => data.txs.filter(x => x.tags?.includes(t)).length
  const add = async () => {
    const n = name.trim().replace(/^#/, '')
    if (!n) return
    if (tags.some(t => t.toLocaleLowerCase('ru') === n.toLocaleLowerCase('ru'))) return setError('Такая метка уже есть')
    await saveSettings({ tags: [...tags, n] })
    setName(''); setError('')
  }
  const remove = async (t: string) => {
    await saveSettings({ tags: tags.filter(x => x !== t) })
    notify(`Метка #${t} убрана из списка`, () => saveSettings({ tags }))
  }
  return (
    <>
      <div className="list">
        {tags.map(t => (
          <div key={t} className="row noic" style={{ padding: '0.3rem 0.82rem' }}>
            <span className="body"><span className="title">#{t}</span><span className="sub">{used(t) ? `${used(t)} ${plural(used(t), ['операция', 'операции', 'операций'])}` : 'не использовалась'}</span></span>
            <button className="icon-btn" aria-label={`Убрать метку ${t}`} onClick={() => remove(t)}><Icon name="close" size={14} /></button>
          </div>
        ))}
        {tags.length === 0 && <p className="hint" style={{ padding: '0.5rem 0.82rem' }}>Меток нет.</p>}
      </div>
      <label className="field-label" htmlFor="new-tag">Новая метка</label>
      <input id="new-tag" value={name} onChange={e => { setName(e.target.value); setError('') }} onKeyDown={e => e.key === 'Enter' && add()} enterKeyHint="done" placeholder="Например, Ремонт" />
      {error && <p className="error">{error}</p>}
      <button className="save" onClick={add} disabled={!name.trim()}>Добавить</button>
      <p className="hint">Метка отмечает операции поперёк категорий: проект, поездку, обязательные траты. У операции может быть несколько меток. Убранная из списка метка остаётся на старых операциях.</p>
    </>
  )
}

const fundLabel = (f: Recurring['fundFrom'], d: Data) =>
  f === 'both' ? 'пополам из зарплаты и аванса' : f === 'salary' ? `из зарплаты ${d.settings.salaryDay}-го` : `из аванса ${d.settings.advanceDay}-го`

export function RecurringSection({ data }: { data: Data }) {
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null)
  if (edit) return <RecurringForm data={data} r={edit} onDone={() => setEdit(null)} />
  const payments = data.recurring.filter(r => r.kind !== 'topup').sort((a, b) => a.day - b.day)
  const topups = data.recurring.filter(r => r.kind === 'topup')
  const acc = (id?: number | null) => data.accounts.find(a => a.id === id)?.name
  return (
    <>
      <div className="day">Платежи</div>
      <div className="card tight">
        {payments.map(r => (
          <button className="row" key={r.id} onClick={() => setEdit(r)}>
            <span className={r.active ? '' : 'muted'}>{r.day}-го · {r.name}<div className="muted small">{fundLabel(r.fundFrom, data)}{acc(r.reserveAccountId) ? ` → ${acc(r.reserveAccountId)}` : ''}</div></span>
            <Money v={r.amount} cur={r.currency} />
          </button>
        ))}
        {payments.length === 0 && <p className="hint">Например: аренда 1-го из зарплаты, кредит 29-го из аванса.</p>}
      </div>
      <button className="secondary" onClick={() => setEdit({ kind: 'payment', currency: 'RUB', fundFrom: 'salary', active: true })}>+ Платёж</button>

      <div className="day">Пополнения копилок</div>
      <div className="card tight">
        {topups.map(r => (
          <button className="row" key={r.id} onClick={() => setEdit(r)}>
            <span className={r.active ? '' : 'muted'}>{acc(r.reserveAccountId) ?? r.name}<div className="muted small">{fundLabel(r.fundFrom, data)}</div></span>
            <Money v={r.amount} cur={r.currency} />
          </button>
        ))}
        {topups.length === 0 && <p className="hint">Например: Aristo — 15 000 ₽ в месяц, пополам из зарплаты и аванса.</p>}
      </div>
      <button className="secondary" onClick={() => setEdit({ kind: 'topup', currency: 'RUB', fundFrom: 'both', active: true, day: 1 })}>+ Пополнение копилки</button>
    </>
  )
}

export function RecurringForm({ data, r, onDone }: { data: Data; r: Partial<Recurring>; onDone: () => void }) {
  const isTopup = r.kind === 'topup'
  const [name, setName] = useState(r.name ?? '')
  const [amount, setAmount] = useState(toInput(r.amount))
  const [currency, setCurrency] = useState<Currency>(r.currency ?? 'RUB')
  const [day, setDay] = useState(String(r.day ?? 1))
  const [categoryId, setCategoryId] = useState<number | undefined>(r.categoryId)
  const [fundFrom, setFundFrom] = useState<Recurring['fundFrom']>(r.fundFrom ?? 'salary')
  const [active, setActive] = useState(r.active ?? true)
  const [reserveAccountId, setReserveAccountId] = useState<number | null>(r.reserveAccountId ?? null)
  const [error, setError] = useState('')
  const cats = data.categories.filter(c => !c.archived && !c.system && (c.kind ?? 'expense') === 'expense')
  const label = (c: Category) => (c.parentId != null ? `${data.categories.find(p => p.id === c.parentId)?.name} · ${c.name}` : c.name)
  const accounts = data.accounts.filter(a => !a.archived && a.currency === currency)

  const save = useOnce(async () => {
    const a = fromInput(amount)
    if (!a) return setError('Введи сумму')
    if (isTopup && reserveAccountId == null) return setError('Выбери копилку')
    if (categoryId == null) return setError('Выбери категорию')
    const title = name.trim() || (isTopup ? data.accounts.find(x => x.id === reserveAccountId)?.name ?? 'Пополнение' : '')
    if (!title) return setError('Введи название')
    await db.recurring.put({
      ...(r as Recurring), kind: isTopup ? 'topup' : 'payment', name: title, amount: a, currency,
      day: Math.min(31, Math.max(1, Number(day) || 1)), categoryId, fundFrom, reserveAccountId, active,
    })
    onDone()
  })
  const remove = useOnce(async () => {
    const snapshot = await db.recurring.get(r.id!)
    await db.recurring.delete(r.id!)
    onDone()
    if (snapshot) notify(`«${snapshot.name}» удалено`, () => db.recurring.put(snapshot).then(() => {}))
  })
  return (
    <>
      {isTopup ? (
        <>
          <label className="field-label">Копилка</label>
          <select value={reserveAccountId ?? ''} onChange={e => setReserveAccountId(e.target.value ? Number(e.target.value) : null)}>
            <option value="" disabled>Выбери счёт</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="field-label">Сумма в месяц</label>
        </>
      ) : (
        <>
          <label className="field-label">Название</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Аренда" autoFocus={!r.id} />
          <label className="field-label">Сумма</label>
        </>
      )}
      <AmountInput value={amount} onChange={setAmount} suffix={CUR_SUFFIX[currency]} />
      <Chips options={CURRENCIES.map(c => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
      {!isTopup && (
        <>
          <label className="field-label">Число месяца</label>
          <input inputMode="numeric" value={day} onChange={e => setDay(e.target.value)} />
        </>
      )}
      <label className="field-label">{isTopup ? 'На что тратятся деньги из копилки' : 'Категория'}</label>
      <select value={categoryId ?? ''} onChange={e => setCategoryId(Number(e.target.value))}>
        <option value="" disabled>Выбери</option>
        {cats.sort((a, b) => label(a).localeCompare(label(b))).map(c => <option key={c.id} value={c.id}>{label(c)}</option>)}
      </select>
      <label className="field-label">{isTopup ? 'Откладывать из' : 'Резервировать из'}</label>
      <Chips options={[
        { value: 'salary' as const, label: `Зарплаты (${data.settings.salaryDay}-го)` },
        { value: 'advance' as const, label: `Аванса (${data.settings.advanceDay}-го)` },
        { value: 'both' as const, label: 'Пополам' },
      ]} value={fundFrom} onChange={setFundFrom} />
      {!isTopup && (
        <>
          <label className="field-label">Копилка для этого платежа</label>
          <select value={reserveAccountId ?? ''} onChange={e => setReserveAccountId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Нет — деньги остаются на основном счёте</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <p className="hint">Например, «Квартира» для аренды. При распределении зарплаты приложение предложит перевести резерв на этот счёт, а «Оплатил» спишет платёж с него.</p>
        </>
      )}
      <label className="check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Активно</label>
      {error && <p className="error">{error}</p>}
      <button className="save" onClick={save}>Сохранить</button>
      {r.id && <button className="danger" onClick={remove}>Удалить</button>}
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
