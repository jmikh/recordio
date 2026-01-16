import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import App from './App.tsx'
import { initSentry } from '../../utils/sentry'

// Initialize Sentry for error tracking
initSentry('popup');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
