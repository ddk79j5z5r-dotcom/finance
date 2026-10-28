import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { project, reducedMotion, rubberband, spring } from './motion'
import { amountToInput, formatMoney, parseAmount } from '../domain/money'
import type { Currency } from '../domain/types'
import { Icon, type IconName } from './icons'

// ---------- Окно снизу: выезжает на пружине, тянется пальцем, закрывается смахиванием ----------

interface SheetLayer { depth: (p: number, animate?: boolean) => void }
/** Открытые окна снизу вверх: под дочерним окном родительское отъезжает назад и темнеет. */
const layers: SheetLayer[] = []
let scrollLocks = 0

export function Sheet({ title, onClose, children, full = false }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const st = useRef({
    y: 0, h: 0, closing: false, stop: null as null | (() => void), render: (_: number) => {},
    drag: null as null | { y0: number; start: number; head: boolean; active: boolean; hist: { t: number; y: number }[] },
    moved: false,
  })

  useEffect(() => {
    const sheet = sheetRef.current!, scrim = scrimRef.current!, s = st.current
    if (scrollLocks++ === 0) document.body.classList.add('noscroll')
    const parent = layers.at(-1)
    const layer: SheetLayer = {
      depth(p, animate) {
        sheet.style.transition = animate ? 'transform .3s cubic-bezier(.2,.8,.2,1), filter .3s' : 'none'
        sheet.style.transform = `translate3d(0,${s.y}px,0) scale(${1 - 0.05 * p})`
        sheet.style.filter = p > 0 ? `brightness(${1 - 0.2 * p})` : ''
      },
    }
    layers.push(layer)
    s.render = v => {
      s.y = v
      sheet.style.transition = 'none'
      sheet.style.transform = `translate3d(0,${v}px,0)`
      const p = s.h > 0 ? Math.min(1, Math.max(0, 1 - v / s.h)) : 1
      scrim.style.opacity = String(p)
      parent?.depth(p)
    }
    s.h = sheet.offsetHeight
    if (reducedMotion()) {
      // Уменьшение движения: плавное проявление вместо выезда.
      s.render(0)
      sheet.style.opacity = '0'; scrim.style.opacity = '0'
      void sheet.offsetHeight // применить начальную прозрачность до перехода
      sheet.style.transition = scrim.style.transition = 'opacity .2s ease'
      sheet.style.opacity = '1'; scrim.style.opacity = '1'
      parent?.depth(1, true)
    } else {
      s.render(s.h)
      s.stop = spring(s.h, 0, 0, { damping: 1, response: 0.38 }, s.render)
    }
    return () => {
      s.stop?.()
      layers.splice(layers.indexOf(layer), 1)
      parent?.depth(0, true)
      if (--scrollLocks === 0) document.body.classList.remove('noscroll')
    }
  }, [])

  /** Закрыть с анимацией: уезжает вниз туда же, откуда приехало, с текущей скоростью пальца. */
  const close = (velocity = 0) => {
    const s = st.current, sheet = sheetRef.current, scrim = scrimRef.current
    if (s.closing || !sheet || !scrim) return
    s.closing = true
    s.stop?.()
    if (reducedMotion()) {
      sheet.style.transition = scrim.style.transition = 'opacity .18s ease'
      sheet.style.opacity = '0'; scrim.style.opacity = '0'
      setTimeout(() => closeRef.current(), 180)
      return
    }
    s.h = sheet.offsetHeight
    // Готово, как только окно целиком ушло за край, — не ждём «хвоста» пружины.
    let done = false
    const finish = () => { if (!done) { done = true; s.stop?.(); closeRef.current() } }
    s.stop = spring(s.y, s.h + 60, Math.max(0, velocity), { damping: 1, response: 0.3 }, v => { s.render(v); if (v >= s.h) finish() }, finish)
  }

  // Перетаскивание: за «ручку» и заголовок — всегда, за содержимое — вниз, когда оно прокручено к началу.
  const onPointerDown = (e: React.PointerEvent) => {
    const s = st.current, sheet = sheetRef.current!
    s.moved = false
    if (s.closing || reducedMotion() || document.documentElement.classList.contains('kb-open')) return
    const t = e.target as Element
    if (t.closest('input, textarea, select, .keypad, .scroll-row, .an-chart')) return
    const body = sheet.querySelector('.sheet-body')!
    const head = !body.contains(t)
    if (!head && (full || body.scrollTop > 0)) return
    s.drag = { y0: s.y, start: e.clientY, head, active: false, hist: [{ t: e.timeStamp, y: e.clientY }] }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current, d = s.drag
    if (!d) return
    const dy = e.clientY - d.start
    if (!d.active) {
      if (Math.abs(dy) < 8) return // порог: касание не превращается в перетаскивание
      if (!d.head && dy < 0) { s.drag = null; return } // вверх по содержимому — это прокрутка
      d.active = true
      s.moved = true
      s.stop?.()
      sheetRef.current!.setPointerCapture(e.pointerId)
    }
    d.hist.push({ t: e.timeStamp, y: e.clientY })
    if (d.hist.length > 6) d.hist.shift()
    const raw = d.y0 + dy
    s.render(raw < 0 ? rubberband(raw, s.h) : raw)
  }
  const onPointerUp = () => {
    const s = st.current, d = s.drag
    s.drag = null
    if (!d?.active) return
    const a = d.hist[0], b = d.hist[d.hist.length - 1]
    const v = b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0
    // Решает, куда «долетит» окно с этой скоростью, а не где отпустили палец.
    if (s.y + project(v) > s.h * 0.5) close(v)
    else s.stop = spring(s.y, 0, v, { damping: 0.85, response: 0.32 }, s.render)
  }
  // На iPhone прокрутка перехватывает жест — пока окно тянут, её отменяем.
  useEffect(() => {
    const sheet = sheetRef.current!
    const onTouchMove = (e: TouchEvent) => { if (st.current.drag?.active) e.preventDefault() }
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => sheet.removeEventListener('touchmove', onTouchMove)
  }, [])

  return (
    <div className="sheet-backdrop">
      <div className="sheet-scrim" ref={scrimRef} onClick={() => close()} />
      <div ref={sheetRef} className={full ? 'sheet full' : 'sheet'} role="dialog" aria-label={title}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClickCapture={e => { if (st.current.moved) { e.stopPropagation(); e.preventDefault(); st.current.moved = false } }}>
        {!full && <div className="sheet-grip" aria-hidden="true"><i /></div>}
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Закрыть" onClick={() => close()}><Icon name="close" /></button>
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

/** Сумма — всегда точно, с копейками (округление сбивало при переводе «всего остатка»). */
export function Money({ v, cur = 'RUB', sign = false }: { v: number; cur?: Currency; sign?: boolean }) {
  const hidden = useAmountsHidden()
  if (hidden) return <span className="money">••••</span>
  return <span className="money">{sign && v > 0 ? '+' : ''}{formatMoney(v, cur)}</span>
}

/** Поле суммы: хранит строку, наружу отдаёт копейки через fromInput. */
export function AmountInput({ value, onChange, placeholder = '0', big = false, autoFocus = false, suffix, tone }: {
  value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; autoFocus?: boolean; suffix?: string; tone?: string
}) {
  return (
    <div className={['amount', big && 'big', tone].filter(Boolean).join(' ')}>
      <input
        inputMode="decimal"
        autoComplete="off"
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
