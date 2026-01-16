import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../index.css'
import { initSentry } from '../utils/sentry'

// Initialize Sentry for error tracking
initSentry('editor');

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
