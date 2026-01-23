import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../index.css'
import { initSentry } from '../utils/sentry'
import { trackPageView } from '../core/analytics'

// Initialize Sentry for error tracking
initSentry('editor');

// Track page view
trackPageView('editor');

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

