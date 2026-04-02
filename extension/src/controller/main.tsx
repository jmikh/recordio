import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { ControllerApp } from './ControllerApp'
import { initSentry } from '../utils/sentry'

// Initialize Sentry for error tracking
initSentry('controller');

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ControllerApp />
    </StrictMode>,
)
