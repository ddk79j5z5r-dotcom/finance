import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { db } from './db'
import { refreshLatestRate } from './domain/rates'
import { seedIfEmpty } from './domain/seed'
import './index.css'

registerSW({ immediate: true })

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
})
