/**
 * Движение по принципам Apple (WWDC «Designing Fluid Interfaces»):
 * пружина задаётся затуханием и «откликом» (сек), а не длительностью; стартует с текущего
 * положения и скорости — поэтому её можно перехватить в любой момент.
 */

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Пружина от `from` к `to` с начальной скоростью `v0` (ед./с). Возвращает функцию остановки. */
export function spring(
  from: number, to: number, v0: number,
  { damping = 1, response = 0.35 }: { damping?: number; response?: number },
  onUpdate: (x: number) => void,
  onDone?: () => void,
): () => void {
  const k = (2 * Math.PI / response) ** 2
  const c = (4 * Math.PI * damping) / response
  let x = from, v = v0, last = performance.now(), id = 0
  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000)
    last = now
    v += (-k * (x - to) - c * v) * dt
    x += v * dt
    if (Math.abs(x - to) < 1 && Math.abs(v) < 40) { onUpdate(to); onDone?.(); return }
    onUpdate(x)
    id = requestAnimationFrame(step)
  }
  id = requestAnimationFrame(step)
  return () => cancelAnimationFrame(id)
}

/** Куда «долетит» жест с такой скоростью (px/с) — как инерция прокрутки iOS. */
export const project = (velocity: number, deceleration = 0.998) => (velocity / 1000) * deceleration / (1 - deceleration)

/** Сопротивление за границей: чем дальше тянешь, тем меньше элемент следует за пальцем. */
export const rubberband = (overshoot: number, dimension: number, c = 0.55) =>
  (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot))

const PRESSABLE = 'button, .row-main, label.chip, .date-chip'

/** Отклик на касание: подсветка в момент нажатия (pointerdown), снимается при отпускании или если палец повёл (прокрутка). */
export function trackPress() {
  let el: Element | null = null
  let x0 = 0, y0 = 0
  const clear = () => { el?.classList.remove('down'); el = null }
  document.addEventListener('pointerdown', e => {
    const t = (e.target as Element).closest?.(PRESSABLE)
    if (!t || (t as HTMLButtonElement).disabled) return
    el = t
    x0 = e.clientX; y0 = e.clientY
    t.classList.add('down')
  }, { passive: true })
  document.addEventListener('pointermove', e => { if (el && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) clear() }, { passive: true })
  document.addEventListener('pointerup', clear, { passive: true })
  document.addEventListener('pointercancel', clear, { passive: true })
  document.addEventListener('scroll', clear, { passive: true, capture: true })
}
