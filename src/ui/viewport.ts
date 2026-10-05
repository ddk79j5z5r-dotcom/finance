/**
 * Видимая область над экранной клавиатурой iOS.
 * Safari не уменьшает экран под клавиатуру — она просто перекрывает низ, вместе с окнами снизу.
 * Следим за visualViewport и отдаём в CSS:
 *   --vvh  — высота видимой области,
 *   --vvtop — её сдвиг сверху (iOS иногда прокручивает страницу при фокусе),
 *   --kb   — высота клавиатуры (0, если скрыта).
 * Окна (.sheet-backdrop) позиционируются по этим переменным и оказываются ровно над клавиатурой.
 */
export function trackVisualViewport() {
  const vv = window.visualViewport
  const root = document.documentElement
  if (!vv) return
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    root.style.setProperty('--vvh', `${vv.height}px`)
    root.style.setProperty('--vvtop', `${vv.offsetTop}px`)
    root.style.setProperty('--kb', `${kb}px`)
    root.classList.toggle('kb-open', kb > 80)
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()

  // Поле, в которое начали вводить, — в центр видимой части окна, когда клавиатура уже открылась.
  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement
    if (!el.matches('input:not([type=checkbox]):not([type=file]), textarea, select')) return
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
  })
}
