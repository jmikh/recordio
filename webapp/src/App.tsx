import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/ImportPage';

export function App() {
    const [path, setPath] = useState(window.location.pathname);

    useEffect(() => {
        const handlePopState = () => setPath(window.location.pathname);
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // Simple routing
    if (path === '/import' || path.startsWith('/import')) {
        return <ImportPage />;
    }

    if (path === '/editor' || path.startsWith('/editor')) {
        return <EditorPage />;
    }

    // Default to dashboard
    return <DashboardPage />;
}
