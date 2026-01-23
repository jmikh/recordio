import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import App from './App.tsx'
import { initSentry } from '../../utils/sentry'
import { trackPageView } from '../../core/analytics'

// Initialize Sentry for error tracking
initSentry('popup');

// Track page view
trackPageView('popup');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

