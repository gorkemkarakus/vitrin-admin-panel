import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Yazi tipleri pakette (calisma aninda Google Fonts istegi yok).
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import './styles/theme.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
