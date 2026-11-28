import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/bausteine/Toast'
import { initTheme } from './theme'
import { initDisplayScale } from './displayScale'
import './assets/index.css'

initTheme()
initDisplayScale()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
)
