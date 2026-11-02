import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { refreshBonds } from './bondsSync'
import { trackVisualViewport } from './ui/viewport'
import { trackPress } from './ui/motion'
import { db } from './db'
import { refreshLatestRate } from './domain/rates'
import { seedIfEmpty } from './domain/seed'
import './index.css'

// Обновления: приложение с экрана «Домой» на iPhone само новую версию почти не проверяет — просыпается из памяти
// без перезагрузки. Поэтому проверяем при каждом возврате в приложение и раз в полчаса; новая версия
// сразу берёт управление и страница перезагружается (registerType: 'autoUpdate').
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}) }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
    setInterval(check, 30 * 60 * 1000)
  },
})
trackVisualViewport()
trackPress()

// Без зума щипком: Safari на iPhone игнорирует user-scalable=no, поэтому гасим жест вручную.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false })
}
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

// Просим браузер не вытеснять данные при нехватке места.
navigator.storage?.persist?.()

seedIfEmpty(db).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  refreshLatestRate(db)
  refreshBonds()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBonds() })
})
