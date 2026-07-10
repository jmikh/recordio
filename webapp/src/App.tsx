import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/import/ImportPage';
import { VideoPage } from './pages/VideoPage';
import { UninstallPage } from './pages/UninstallPage';
import { WorkspaceSettingsPage } from './pages/settings/WorkspaceSettingsPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ToastProvider } from './components/Toast';
import { AuthManager } from './auth/AuthManager';
import { AuthModal } from './auth/AuthModal';
import { useUserStore } from './auth/useUserStore';
import { UploadProgressToast } from './storage/UploadProgressToast';
import { useUploadBeforeUnloadWarning } from './storage/useUploadBeforeUnloadWarning';

// Initialize auth before React renders — ensures onAuthStateChange fires
// before any component tries to make Supabase queries.
AuthManager.init();

// Routes that don't require authentication
function isPublicRoute(path: string) {
    return path.startsWith('/video/') || path === '/uninstall' || path === '/accept-invite';
}

export function App() {
    const [path, setPath] = useState(window.location.pathname);
    const [authReady, setAuthReady] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);

    useUploadBeforeUnloadWarning();

    useEffect(() => {
        AuthManager.ready.then(() => setAuthReady(true));
    }, []);

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

        if (path === '/accept-invite') {
            return <AcceptInvitePage />;
        }

        if (path === '/workspace/settings') {
            // Redirect bare path to the default tab
            window.history.replaceState({}, '', '/workspace/settings/general');
            return <WorkspaceSettingsPage />;
        }

        if (path.startsWith('/workspace/settings/')) {
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

    const showAuthModal = authReady && !isAuthenticated && !isPublicRoute(path);

    return (
        <ToastProvider>
            {getPage()}
            <AuthModal isOpen={showAuthModal} onClose={() => {}} />
            <UploadProgressToast />
        </ToastProvider>
    );
}
