import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { WelcomeApp } from './WelcomeApp';
import { initSentry } from '../utils/sentry';

initSentry('welcome');

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <WelcomeApp />
    </StrictMode>,
);
