import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { db } from './db'
import { refreshLatestRate } from './domain/rates'
import { seedIfEmpty } from './domain/seed'
import './index.css'

registerSW({ immediate: true })

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
