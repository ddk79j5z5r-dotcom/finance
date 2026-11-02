import { useState, type ReactNode } from 'react'
import { saveSettings } from '../db'
import { monthLabel, monthOf, shiftMonth, todayISO } from '../domain/money'
import { incomeForecast, type IncomeItem } from '../domain/pay'
import type { Settings } from '../domain/types'
import { AmountInput, BigMoney, fromInput, Money, Segmented, Sheet, toInput, useOnce } from './common'
import type { Data } from './data'
import { categoryIcon, Icon, type IconName } from './icons'

const RATES = [13, 15, 18, 20, 22, 30, 0]
const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const dayLabel = (d: number) => (d ? `${d}-го` : 'С зарплатой')
const dayMonth = (iso: string) => `${Number(iso.slice(8))} ${GEN[Number(iso.slice(5, 7)) - 1]}`

interface Extra { name: string; amount: string; day: number; taxed: boolean }

/** Строка формы в стиле настроек iOS: подпись слева, значение или поле справа. */
function FormRow({ label, sub, children, onClick, chevron = false }: { label: ReactNode; sub?: string; children?: ReactNode; onClick?: () => void; chevron?: boolean }) {
  const body = (
    <>
      <span className="body"><span className="title">{label}</span>{sub && <span className="sub">{sub}</span>}</span>
      <span className="form-val">{children}</span>
      {chevron && <Icon name="right" size={14} />}
    </>
  )
  return onClick ? <button className="row noic form-row" onClick={onClick}>{body}</button> : <div className="row noic form-row">{body}</div>
}

/** Выбор числа месяца нативным списком поверх строки. */
function DaySelect({ value, onChange, withSalary = false, label }: { value: number; onChange: (d: number) => void; withSalary?: boolean; label: string }) {
  return (
    <span className="select-wrap">
      {dayLabel(value)}
      <select aria-label={label} value={value} onChange={e => onChange(Number(e.target.value))}>
        {withSalary && <option value={0}>С зарплатой</option>}
        {Array.from({ length: 31 }, (_, k) => <option key={k + 1} value={k + 1}>{k + 1}-го числа</option>)}
      </select>
    </span>
  )
}

/** Выплаты: настройки расчёта и прогноз поступлений по месяцам. Прогноз считается по введённому, ещё до сохранения. */
export function Payouts({ data, onDone }: { data: Data; onDone: () => void }) {
  const s = data.settings
  const [tab, setTab] = useState<'settings' | 'forecast'>('settings')
  const [mode, setMode] = useState<'calc' | 'manual'>(s.pay?.gross ? 'calc' : 'manual')
  const [salaryDay, setSalaryDay] = useState(s.salaryDay)
  const [advanceDay, setAdvanceDay] = useState(s.advanceDay)
  const [salary, setSalary] = useState(toInput(s.expectedSalary))
  const [advance, setAdvance] = useState(toInput(s.expectedAdvance))
  const [gross, setGross] = useState(toInput(s.pay?.gross))
  const [bonus, setBonus] = useState(toInput(s.pay?.bonus))
  const [rate, setRate] = useState(s.pay?.rate ?? 13)
  const [deduction, setDeduction] = useState(toInput(s.pay?.deduction))
  const [taxOpen, setTaxOpen] = useState(false)
  const [premOn, setPremOn] = useState(!!s.pay?.premium?.value)
  const [premMode, setPremMode] = useState<'percent' | 'amount'>(s.pay?.premium?.mode ?? 'percent')
  const [premValue, setPremValue] = useState(s.pay?.premium ? (s.pay.premium.mode === 'percent' ? String(s.pay.premium.value) : toInput(s.pay.premium.value)) : '')
  const [premDay, setPremDay] = useState(s.pay?.premium?.day ?? 0)
  const [extras, setExtras] = useState<Extra[]>((s.pay?.extras ?? []).map(x => ({ name: x.name, amount: toInput(x.amount), day: x.day, taxed: x.taxed })))
  const [editExtra, setEditExtra] = useState<number | null>(null)
  const [month, setMonth] = useState(monthOf(todayISO()))
  const [open, setOpen] = useState<string | null>('salary')
  const [howOpen, setHowOpen] = useState(false)

  const calc = mode === 'calc'
  const pm = calc ? premMode : 'amount'
  const premium = premOn ? { mode: pm, value: pm === 'percent' ? Math.max(0, Number(premValue.replace(',', '.')) || 0) : fromInput(premValue) ?? 0, day: premDay } : undefined
  const extraList = extras.map(x => ({ name: x.name.trim(), amount: fromInput(x.amount) ?? 0, day: x.day, taxed: x.taxed })).filter(x => x.name && x.amount)
  const pay = {
    gross: calc ? fromInput(gross) ?? 0 : 0, bonus: calc ? fromInput(bonus) ?? 0 : 0, rate, deduction: fromInput(deduction) ?? 0,
    premium: premium && premium.value > 0 ? premium : undefined,
    extras: extraList.length ? extraList : undefined,
  }
  const hasPay = pay.gross > 0 || !!pay.premium || !!pay.extras
  const draft: Settings = { ...s, salaryDay, advanceDay, expectedSalary: fromInput(salary) ?? 0, expectedAdvance: fromInput(advance) ?? 0, pay: hasPay ? pay : undefined }
  const thisMonth = incomeForecast(draft, monthOf(todayISO())).reduce((a, d) => a + d.total, 0)
  const forecast = incomeForecast(draft, month)
  const total = forecast.reduce((a, d) => a + d.total, 0)

  const save = useOnce(async () => {
    await saveSettings({ salaryDay, advanceDay, expectedSalary: draft.expectedSalary, expectedAdvance: draft.expectedAdvance, pay: draft.pay })
    onDone()
  })
  const setExtra = (i: number, patch: Partial<Extra>) => setExtras(list => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const extraIcon = (name: string): IconName => categoryIcon({ name, icon: undefined } as never)

  return (
    <div className="payouts">
      <Segmented value={tab} onChange={setTab} options={[{ value: 'settings', label: 'Настройки' }, { value: 'forecast', label: 'Прогноз' }]} />

      {tab === 'settings' ? (
        <>
          <h4 className="form-cap">Способ расчёта</h4>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'calc', label: 'По окладу' }, { value: 'manual', label: 'Вручную' }]} />

          <h4 className="form-cap">График</h4>
          <div className="list">
            <FormRow label="Зарплата" chevron><DaySelect label="Число зарплаты" value={salaryDay} onChange={setSalaryDay} /></FormRow>
            <FormRow label="Аванс" chevron><DaySelect label="Число аванса" value={advanceDay} onChange={setAdvanceDay} /></FormRow>
          </div>

          {calc ? (
            <>
              <h4 className="form-cap">Начисления<span>Суммы до налога</span></h4>
              <div className="list">
                <FormRow label="Оклад"><AmountInput value={gross} onChange={setGross} suffix="₽" placeholder="0" /></FormRow>
                <FormRow label="Надбавки"><AmountInput value={bonus} onChange={setBonus} suffix="₽" placeholder="0" /></FormRow>
              </div>
            </>
          ) : (
            <>
              <h4 className="form-cap">Ожидаемые суммы<span>На руки</span></h4>
              <div className="list">
                <FormRow label="Зарплата"><AmountInput value={salary} onChange={setSalary} suffix="₽" placeholder="0" /></FormRow>
                <FormRow label="Аванс"><AmountInput value={advance} onChange={setAdvance} suffix="₽" placeholder="0" /></FormRow>
              </div>
            </>
          )}

          <h4 className="form-cap">Премия</h4>
          <div className="list">
            <FormRow label="Ежемесячная премия">
              <label className="switch"><input type="checkbox" role="switch" checked={premOn} onChange={e => setPremOn(e.target.checked)} aria-label="Ежемесячная премия" /><i /></label>
            </FormRow>
            {premOn && (
              <>
                <FormRow label="Размер">
                  <span className="prem-size">
                    {pm === 'percent'
                      ? <span className="amount"><input inputMode="decimal" value={premValue} onChange={e => setPremValue(e.target.value)} placeholder="0" aria-label="Процент премии" /><span className="suffix">%</span></span>
                      : <AmountInput value={premValue} onChange={setPremValue} suffix="₽" placeholder="0" />}
                    {calc && <button className="unit-btn" onClick={() => { setPremMode(m => (m === 'percent' ? 'amount' : 'percent')); setPremValue('') }} aria-label={pm === 'percent' ? 'Задать суммой' : 'Задать процентом от оклада'}>{pm === 'percent' ? 'от оклада' : 'сумма'}</button>}
                  </span>
                </FormRow>
                <FormRow label="Выплата" chevron><DaySelect label="Когда приходит премия" value={premDay} onChange={setPremDay} withSalary /></FormRow>
              </>
            )}
          </div>

          <h4 className="form-cap">Налоги и вычеты</h4>
          <div className="list">
            <FormRow label="Параметры расчёта" chevron onClick={() => setTaxOpen(v => !v)}><span className="muted">{taxOpen ? 'Скрыть' : `НДФЛ ${rate}%`}</span></FormRow>
            {taxOpen && (
              <>
                <FormRow label="Ставка НДФЛ" chevron>
                  <span className="select-wrap">{rate}%
                    <select aria-label="Ставка НДФЛ" value={rate} onChange={e => setRate(Number(e.target.value))}>
                      {RATES.map(x => <option key={x} value={x}>{x}%{x === 13 ? ' — обычный' : x === 0 ? ' — без налога' : ''}</option>)}
                    </select>
                  </span>
                </FormRow>
                <FormRow label="Вычеты в месяц" sub="например, на ребёнка 1 400 ₽"><AmountInput value={deduction} onChange={setDeduction} suffix="₽" placeholder="0" /></FormRow>
              </>
            )}
          </div>

          <h4 className="form-cap">Другие поступления</h4>
          <div className="list">
            {extras.map((x, i) => (
              <button key={i} className="row form-row" onClick={() => setEditExtra(i)}>
                <span className="form-ico"><Icon name={extraIcon(x.name)} size={18} /></span>
                <span className="body"><span className="title">{x.name || 'Без названия'}</span><span className="sub">{dayLabel(x.day)} · {x.taxed ? 'до налога' : 'без налога'}</span></span>
                <span className="form-val">{fromInput(x.amount) ? <Money v={fromInput(x.amount)!} whole /> : '—'}</span>
                <Icon name="right" size={14} />
              </button>
            ))}
          </div>
          <button className="add-link" onClick={() => { setExtras(list => [...list, { name: '', amount: '', day: 0, taxed: true }]); setEditExtra(extras.length) }}>+ Добавить выплату</button>

          <div className="pay-total">
            <span><b>Прогноз на {monthLabel(monthOf(todayISO())).split(' ')[0].toLowerCase()}</b><span>Расчётная сумма на руки</span></span>
            <span className="pos"><Money v={thisMonth} whole /></span>
          </div>
        </>
      ) : (
        <>
          <div className="month-pill">
            <button className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setMonth(m => shiftMonth(m, -1))}><Icon name="left" size={16} /></button>
            <strong aria-live="polite">{monthLabel(month)}</strong>
            <button className="icon-btn" aria-label="Следующий месяц" onClick={() => setMonth(m => shiftMonth(m, 1))}><Icon name="right" size={16} /></button>
          </div>

          <div className="card fc-card">
            <div className="fc-top"><span className="cap">Ожидается за месяц</span><span className="fc-pill">Прогноз</span></div>
            <BigMoney v={total} className="fc-v pos" />
            {total > 0 && (
              <>
                <div className="fc-bar" aria-hidden="true">{forecast.map((d, i) => <i key={d.date} className={i % 2 ? 'b' : 'a'} style={{ flexGrow: d.total }} />)}</div>
                <div className="fc-legend">
                  {forecast.map((d, i) => <span key={d.date}><i className={i % 2 ? 'b' : 'a'} /><span>{dayMonth(d.date)}</span><b><Money v={d.total} whole /></b></span>)}
                </div>
              </>
            )}
          </div>

          {forecast.length === 0 && <p className="hint">В этом месяце поступлений не ожидается — задайте оклад или суммы во вкладке «Настройки».</p>}
          {forecast.map(d => (
            <section key={d.date}>
              <div className="fc-day"><b>{dayMonth(d.date)}</b><b className="pos"><Money v={d.total} whole /></b></div>
              <div className="list">
                {d.items.map(it => <ForecastRow key={it.key} it={it} open={open === it.key} onToggle={() => setOpen(o => (o === it.key ? null : it.key))} icon={it.kind === 'extra' ? extraIcon(it.name) : undefined} />)}
              </div>
            </section>
          ))}

          <div className="card fc-info">
            <Icon name="info" size={20} />
            <div>
              <p>Это прогноз. После поступления в расчёт пойдёт фактическая сумма.</p>
              <button className="link" onClick={() => setHowOpen(v => !v)}>{howOpen ? 'Скрыть' : 'Как считается'} <Icon name={howOpen ? 'up' : 'right'} size={12} /></button>
              {howOpen && (
                <ul>
                  <li>Аванс = (оклад + надбавки) × рабочие дни с 1 по 15 ÷ рабочие дни месяца − НДФЛ. Дни — по производственному календарю.</li>
                  <li>За месяц: оклад + надбавки + премия + выплаты «с зарплатой» − НДФЛ со всей суммы (минус вычеты) = на руки.</li>
                  <li>Зарплата = на руки за месяц − аванс. {salaryDay < advanceDay ? 'Зарплата приходит раньше аванса, поэтому она — за прошлый месяц.' : 'Зарплата — за текущий месяц.'}</li>
                  <li>Больничные, отпуск и неполный месяц не учитываются.</li>
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className="sheet-actions"><button className="save" onClick={save}>Сохранить</button></div>

      {editExtra != null && extras[editExtra] && (
        <Sheet title={extras[editExtra].name || 'Новая выплата'} onClose={() => { setExtras(list => list.filter(x => x.name.trim() || x.amount)); setEditExtra(null) }}>
          <label className="field-label" htmlFor="ex-name">Название</label>
          <input id="ex-name" value={extras[editExtra].name} onChange={e => setExtra(editExtra, { name: e.target.value })} placeholder="Например, компенсация жилья" autoFocus={!extras[editExtra].name} />
          <label className="field-label">Сумма</label>
          <AmountInput value={extras[editExtra].amount} onChange={v => setExtra(editExtra, { amount: v })} suffix="₽" placeholder="0" />
          <div className="list" style={{ marginTop: '0.8rem' }}>
            <FormRow label="Когда приходит" chevron><DaySelect label="Когда приходит выплата" value={extras[editExtra].day} onChange={d => setExtra(editExtra, { day: d })} withSalary /></FormRow>
            <FormRow label="Удерживается НДФЛ" sub={extras[editExtra].taxed ? 'сумма указана до налога' : 'сумма на руки'}>
              <label className="switch"><input type="checkbox" role="switch" checked={extras[editExtra].taxed} onChange={e => setExtra(editExtra, { taxed: e.target.checked })} aria-label="Удерживается НДФЛ" /><i /></label>
            </FormRow>
          </div>
          <button className="save" onClick={() => { setExtras(list => list.filter(x => x.name.trim() || x.amount)); setEditExtra(null) }}>Готово</button>
          <button className="danger" onClick={() => { setExtras(list => list.filter((_, j) => j !== editExtra)); setEditExtra(null) }}>Удалить выплату</button>
        </Sheet>
      )}
    </div>
  )
}

const KIND_ICON: Record<IncomeItem['kind'], IconName> = { salary: 'briefcase', advance: 'wallet', premium: 'star', extra: 'banknote' }

/** Строка прогноза: значок, название, сумма; с расшифровкой — раскрывается. */
function ForecastRow({ it, open, onToggle, icon }: { it: IncomeItem; open: boolean; onToggle: () => void; icon?: IconName }) {
  const expandable = it.lines.length > 0
  return (
    <div className={open && expandable ? 'fc-item open' : 'fc-item'}>
      <button className="row form-row" onClick={expandable ? onToggle : undefined} aria-expanded={expandable ? open : undefined}>
        <span className="form-ico accent"><Icon name={icon ?? KIND_ICON[it.kind]} size={18} /></span>
        <span className="body"><span className="title">{it.name}</span>{it.note && <span className="sub">{it.note}</span>}</span>
        <span className="form-val pos"><Money v={it.amount} whole /></span>
        {expandable && <Icon name={open ? 'up' : 'down'} size={14} />}
      </button>
      {open && expandable && (
        <div className="fc-lines">
          {it.lines.map(l => <div key={l.label}><span>{l.label}</span><span><Money v={l.value} whole /></span></div>)}
        </div>
      )}
    </div>
  )
}
