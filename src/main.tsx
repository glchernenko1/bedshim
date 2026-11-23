import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import 'antd/dist/reset.css'
import './styles.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline shell (P0 stub): the service worker caches the app at runtime, so a
// second load needs no network. Not used in dev, where Vite serves modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is an enhancement; the app works without it.
    })
  })
}
