import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Icon } from './icons'
import { project, reducedMotion, spring } from './motion'

// ---------- Сворачивающаяся шапка ----------

/**
 * Полупрозрачная полоса сверху с маленьким заголовком. Появляется, когда крупный заголовок страницы
 * уходит под строку состояния (как в Настройках iPhone); до этого сверху ничего не перекрывает содержимое.
 * `scroller` — свой контейнер прокрутки (подраздел); без него — прокрутка окна.
 */
export function TopBar({ title, scroller, active = true, children }: { title: string; scroller?: RefObject<HTMLElement | null>; active?: boolean; children?: ReactNode }) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!active) return
    const el = scroller?.current
    const read = () => setP(Math.max(0, Math.min(1, ((el ? el.scrollTop : window.scrollY) - 8) / 32)))
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read) }
    read()
    const target: HTMLElement | Window = el ?? window
    target.addEventListener('scroll', on, { passive: true })
    return () => { target.removeEventListener('scroll', on); cancelAnimationFrame(raf) }
  }, [scroller, active])
  return (
    <div className={scroller ? 'topbar in-push' : 'topbar'} style={{ ['--p' as string]: p }}>
      <div className="topbar-bg" aria-hidden="true" />
      {children}
      <span className="topbar-title" aria-hidden={p < 0.5}>{title}</span>
    </div>
  )
}

// ---------- Подраздел, выезжающий справа ----------

/**
 * Экран поверх раздела: выезжает справа на пружине, предыдущий уходит назад и темнеет.
 * Назад — кнопкой или смахиванием от левого края (за пальцем, с учётом скорости броска).
 * Держит свою прокрутку: при возврате на вкладку экран остаётся там, где был.
 */
export function Pushed({ title, backLabel, onBack, under, closeSignal = 0, children }: {
  title: string; backLabel: string; onBack: () => void; under: RefObject<HTMLElement | null>
  /** Меняется — экран закрывается с анимацией (повторное касание вкладки). */
  closeSignal?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const st = useRef({ x: 0, w: 0, stop: null as null | (() => void), closing: false, drag: null as null | { x0: number; on: boolean; h: { t: number; x: number }[] } })
  const backRef = useRef(onBack)
  backRef.current = onBack

  const place = (x: number) => {
    const s = st.current, el = ref.current, u = under.current
    s.x = x
    if (el) el.style.transform = x ? `translate3d(${x}px,0,0)` : ''
    if (u) {
      const k = s.w ? 1 - x / s.w : 1
      u.style.transform = k > 0 ? `translate3d(${-0.3 * s.w * k}px,0,0)` : ''
      u.style.filter = k > 0 ? `brightness(${1 - 0.3 * k})` : ''
    }
  }
  useLayoutEffect(() => {
    const s = st.current
    s.w = ref.current!.offsetWidth
    if (reducedMotion()) {
      place(0)
      ref.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 })
    } else {
      place(s.w)
      s.stop = spring(s.w, 0, 0, { damping: 1, response: 0.38 }, place)
    }
    const u = under.current
    return () => { s.stop?.(); if (u) { u.style.transform = ''; u.style.filter = '' } }
  }, [])

  const close = (v = 0) => {
    const s = st.current
    if (s.closing) return
    s.closing = true
    s.stop?.()
    if (reducedMotion()) { backRef.current(); return }
    let done = false
    const finish = () => { if (!done) { done = true; s.stop?.(); backRef.current() } }
    s.stop = spring(s.x, s.w + 20, Math.max(0, v), { damping: 1, response: 0.3 }, x => { place(x); if (x >= s.w) finish() }, finish)
  }

  const signal = useRef(closeSignal)
  useEffect(() => {
    if (signal.current !== closeSignal && closeSignal) close()
    signal.current = closeSignal
  })

  // Смахивание от левого края
  const onDown = (e: React.PointerEvent) => {
    const s = st.current
    const left = e.clientX - ref.current!.getBoundingClientRect().left
    if (s.closing || reducedMotion() || left > 24) return
    s.drag = { x0: e.clientX, on: false, h: [{ t: e.timeStamp, x: e.clientX }] }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = st.current, d = s.drag
    if (!d) return
    const dx = e.clientX - d.x0
    if (!d.on) {
      if (dx < 8) { if (dx < -8) s.drag = null; return }
      d.on = true
      s.stop?.()
      ref.current!.setPointerCapture(e.pointerId)
    }
    d.h.push({ t: e.timeStamp, x: e.clientX })
    if (d.h.length > 6) d.h.shift()
    place(Math.max(0, dx))
  }
  const onUp = () => {
    const s = st.current, d = s.drag
    s.drag = null
    if (!d?.on) return
    const a = d.h[0], b = d.h[d.h.length - 1]
    const v = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0
    if (s.x + project(v) > s.w / 2) close(v)
    else s.stop = spring(s.x, 0, v, { damping: 0.9, response: 0.3 }, place)
  }
  return (
    <div ref={ref} className="pushed" role="region" aria-label={title} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div ref={scroller} className="pushed-scroll">
        <TopBar title={title} scroller={scroller}>
          <button className="back topbar-back" onClick={() => close()}><Icon name="left" size={18} /> {backLabel}</button>
        </TopBar>
        <div className="pushed-body">{children}</div>
      </div>
    </div>
  )
}

// ---------- Смена месяца ----------

/** Содержимое сдвигается в сторону листания месяца; при уменьшении движения — плавно проявляется. */
export function useMonthSlide(key: string) {
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef(key)
  useLayoutEffect(() => {
    if (prev.current === key) return
    const dir = key > prev.current ? 1 : -1
    prev.current = key
    const el = ref.current
    if (!el?.animate) return
    if (reducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
    else el.animate([{ transform: `translateX(${dir * 36}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)' })
  }, [key])
  return ref
}
