/**
 * Видимая область над экранной клавиатурой iOS.
 * Safari не уменьшает экран под клавиатуру — она просто перекрывает низ, вместе с окнами снизу.
 * Следим за visualViewport и отдаём в CSS:
 *   --vvh  — высота видимой области,
 *   --vvtop — её сдвиг сверху (iOS иногда прокручивает страницу при фокусе),
 *   --kb   — высота клавиатуры (0, если скрыта).
 * Класс .kb-open — пока в фокусе текстовое поле (значит, открыта системная клавиатура):
 * своя цифровая клавиатура и нижняя панель на это время прячутся.
 */
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([readonly]), textarea, select'

export function trackVisualViewport() {
  const vv = window.visualViewport
  const root = document.documentElement
  // Высота экрана до открытия клавиатуры: запоминается при фокусе поля (в установленном приложении iOS
  // при клавиатуре может уменьшаться и innerHeight). Без фокуса клавиатуры нет — отступы нулевые,
  // поэтому «резиновая» прокрутка не может навсегда сдвинуть окна вниз.
  let fullH = window.innerHeight
  let textFocused = false

  const update = () => {
    if (!vv || !textFocused) {
      fullH = window.innerHeight
      root.style.setProperty('--vvh', `${window.innerHeight}px`)
      root.style.setProperty('--vvtop', '0px')
      root.style.setProperty('--kb', '0px')
      root.classList.toggle('kb-open', textFocused)
      return
    }
    const kb = Math.max(0, fullH - vv.height - vv.offsetTop)
    root.style.setProperty('--vvh', `${vv.height}px`)
    root.style.setProperty('--vvtop', `${vv.offsetTop}px`)
    root.style.setProperty('--kb', `${kb}px`)
    root.classList.add('kb-open')
  }

  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('orientationchange', () => setTimeout(update, 400))
  window.addEventListener('resize', update)

  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement
    if (!el.matches?.(TEXT_INPUT)) return
    if (!textFocused) fullH = Math.max(window.innerHeight, vv ? vv.height + Math.max(0, vv.offsetTop) : 0)
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
