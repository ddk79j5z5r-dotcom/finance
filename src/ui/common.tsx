import { useEffect, useRef, type ReactNode } from 'react'
import { amountToInput, formatMoney, parseAmount } from '../domain/money'
import type { Currency } from '../domain/types'

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('noscroll')
    return () => document.body.classList.remove('noscroll')
  }, [])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>Закрыть</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export function Money({ v, cur = 'RUB', sign = false }: { v: number; cur?: Currency; sign?: boolean }) {
  return <span className="money">{sign && v > 0 ? '+' : ''}{formatMoney(v, cur)}</span>
}

/** Поле суммы: хранит строку, наружу отдаёт копейки (или null). */
export function AmountInput({ value, onChange, placeholder = '0', big = false, autoFocus = false, suffix }: {
  value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; autoFocus?: boolean; suffix?: string
}) {
  return (
    <div className={big ? 'amount big' : 'amount'}>
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

export function Bar({ value, max, over = false }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0
  return (
    <div className="bar"><div className={over || value > max ? 'fill over' : 'fill'} style={{ width: `${pct}%` }} /></div>
  )
}

export function Chips<T extends string | number>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void
}) {
  return (
    <div className="chips">
      {options.map(o => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'chip on' : 'chip'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
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
