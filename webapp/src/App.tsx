import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/ImportPage';
import { VideoPage } from './pages/VideoPage';
import { UninstallPage } from './pages/UninstallPage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { ToastProvider } from './editor/components/Toast';
import { AuthManager } from './auth/AuthManager';

// Initialize auth before React renders — ensures onAuthStateChange fires
// before any component tries to make Supabase queries.
AuthManager.init();

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

        if (path === '/workspace/settings') {
            return <WorkspaceSettingsPage />;
        }

        if (path === '/import' || path.startsWith('/import')) {
            return <ImportPage />;
        }

        if (path === '/editor' || path.startsWith('/editor')) {
            return <EditorPage />;
        }

        if (path.startsWith('/video/')) {
            return <VideoPage />;
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
