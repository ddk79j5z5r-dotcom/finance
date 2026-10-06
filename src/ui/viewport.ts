/**
 * Видимая область над экранной клавиатурой iOS.
 * Safari не уменьшает экран под клавиатуру — она просто перекрывает низ, вместе с окнами снизу.
 * Следим за visualViewport и отдаём в CSS:
 *   --vvh  — высота видимой области,
 *   --vvtop — её сдвиг сверху (iOS иногда прокручивает страницу при фокусе),
 *   --kb   — высота клавиатуры (0, если скрыта).
 * Класс .kb-open — пока открыта системная клавиатура (или в фокусе текстовое поле):
 * своя цифровая клавиатура и нижняя панель на это время прячутся.
 */
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([readonly]), textarea, select'

export function trackVisualViewport() {
  const vv = window.visualViewport
  const root = document.documentElement
  // Полная высота экрана: в установленном приложении iOS при клавиатуре может уменьшаться и innerHeight,
  // поэтому запоминаем максимум (и сбрасываем при повороте).
  let fullH = window.innerHeight
  let textFocused = false

  const update = () => {
    if (!vv) { root.classList.toggle('kb-open', textFocused); return }
    if (!textFocused) fullH = Math.max(fullH, window.innerHeight, vv.height + vv.offsetTop)
    const kb = Math.max(0, fullH - vv.height - vv.offsetTop)
    root.style.setProperty('--vvh', `${vv.height}px`)
    root.style.setProperty('--vvtop', `${vv.offsetTop}px`)
    root.style.setProperty('--kb', `${kb}px`)
    root.classList.toggle('kb-open', textFocused || kb > 80)
  }

  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('orientationchange', () => setTimeout(() => { fullH = window.innerHeight; update() }, 400))

  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement
    if (!el.matches?.(TEXT_INPUT)) return
    textFocused = true
    update()
    // Когда клавиатура откроется — поле в центр видимой части окна.
    setTimeout(() => { update(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 350)
  })
  document.addEventListener('focusout', e => {
    if (!(e.target as HTMLElement).matches?.(TEXT_INPUT)) return
    // Небольшая задержка: фокус может сразу перейти в соседнее поле.
    setTimeout(() => {
      textFocused = !!document.activeElement?.matches(TEXT_INPUT)
      update()
    }, 120)
  })
  update()
}
