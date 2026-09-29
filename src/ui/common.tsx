import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { amountToInput, formatMoney, parseAmount } from '../domain/money'
import type { Currency } from '../domain/types'
import { Icon, type IconName } from './icons'

export function Sheet({ title, onClose, children, full = false }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  useEffect(() => {
    document.body.classList.add('noscroll')
    return () => document.body.classList.remove('noscroll')
  }, [])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={full ? 'sheet full' : 'sheet'} role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

// ---------- Скрытие сумм (глаз на главной) ----------

const HIDE_KEY = 'hideAmounts'
const listeners = new Set<() => void>()
function readHidden() {
  try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
}
export function setAmountsHidden(v: boolean) {
  try { localStorage.setItem(HIDE_KEY, v ? '1' : '0') } catch { /* приватный режим — просто не запоминаем */ }
  listeners.forEach(l => l())
}
export function useAmountsHidden() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, readHidden)
}

/** Сумма; `round` — до целых (для итогов, где копейки только мешают). */
export function Money({ v, cur = 'RUB', sign = false, round = false }: { v: number; cur?: Currency; sign?: boolean; round?: boolean }) {
  const hidden = useAmountsHidden()
  if (hidden) return <span className="money">••••</span>
  const val = round ? Math.round(v / 100) * 100 : v
  return <span className="money">{sign && val > 0 ? '+' : ''}{formatMoney(val, cur)}</span>
}

/** Поле суммы: хранит строку, наружу отдаёт копейки через fromInput. */
export function AmountInput({ value, onChange, placeholder = '0', big = false, autoFocus = false, suffix, tone }: {
  value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; autoFocus?: boolean; suffix?: string; tone?: string
}) {
  return (
    <div className={['amount', big && 'big', tone].filter(Boolean).join(' ')}>
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value.replace(/[^\d.,\s]/g, ''))}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  )
}

export const toInput = (minor: number | null | undefined) => (minor ? amountToInput(minor) : '')
export const fromInput = (s: string) => parseAmount(s)

export function Bar({ value, max, color, thick = false }: { value: number; max: number; color?: string; thick?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0
  const over = value > max && max > 0
  return (
    <div className={thick ? 'bar thick' : 'bar'}>
      <div className={over ? 'fill over' : 'fill'} style={{ width: `${pct}%`, background: over ? undefined : color }} />
    </div>
  )
}

export function Chips<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: IconName }[]; value: T | null; onChange: (v: T) => void
}) {
  return (
    <div className="chips">
      {options.map(o => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'chip on' : 'chip'} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, className = '' }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string
}) {
  return (
    <div className={`segmented ${className}`}>
      {options.map(o => (
        <button key={o.value} className={o.value === value ? `on ${o.value}` : o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="month-nav">
      <button className="icon-btn" aria-label="Предыдущий месяц" onClick={onPrev}><Icon name="left" /></button>
      <strong>{label}</strong>
      <button className="icon-btn" aria-label="Следующий месяц" onClick={onNext}><Icon name="right" /></button>
    </div>
  )
}

export const CUR_SUFFIX: Record<Currency, string> = { RUB: '₽', USD: '$', EUR: '€' }

/** Защита от двойного нажатия: пока действие выполняется, повторные вызовы игнорируются. */
export function useOnce<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const busy = useRef(false)
  return async (...args: A) => {
    if (busy.current) return
    busy.current = true
    try {
      await fn(...args)
    } finally {
      busy.current = false
    }
  }
}
