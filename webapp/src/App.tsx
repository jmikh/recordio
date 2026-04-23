import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/ImportPage';
import { WatchPage } from './pages/WatchPage';
import { UninstallPage } from './pages/UninstallPage';
import { MacHandoffPage } from './pages/MacHandoffPage';
import { ToastProvider } from './editor/components/Toast';
import { initMacBridge } from './bridge/macBridge';

// Initialize Mac native bridge (no-op if not inside WKWebView)
initMacBridge();
export function App() {
    const [path, setPath] = useState(window.location.pathname);

    useEffect(() => {
        const handleNavigation = () => setPath(window.location.pathname);
        window.addEventListener('popstate', handleNavigation);
        window.addEventListener('navigate', handleNavigation);
        return () => {
            window.removeEventListener('popstate', handleNavigation);
            window.removeEventListener('navigate', handleNavigation);
        };
    }, []);

    // Simple routing
    const getPage = () => {
        if (path === '/uninstall') {
            return <UninstallPage />;
        }

        if (path === '/import' || path.startsWith('/import')) {
            return <ImportPage />;
        }

        if (path === '/editor' || path.startsWith('/editor')) {
            return <EditorPage />;
        }

        if (path.startsWith('/watch/')) {
            return <WatchPage />;
        }

        if (path === '/mac-handoff' || path.startsWith('/mac-handoff')) {
            return <MacHandoffPage />;
        }

        // Default to dashboard
        return <DashboardPage />;
    };

    return (
        <ToastProvider>
            {getPage()}
        </ToastProvider>
    );
}
