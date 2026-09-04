import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/import/ImportPage';
import { VideoPage } from './pages/VideoPage';
import { UninstallPage } from './pages/UninstallPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AdminPage } from './pages/admin/AdminPage';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { ToastProvider } from './components/Toast';
import { AuthManager } from './auth/AuthManager';
import { AuthModal } from './auth/AuthModal';
import { useUserStore } from './auth/useUserStore';
import { UploadProgressToast } from './storage/UploadProgressToast';
import { useUploadBeforeUnloadWarning } from './storage/useUploadBeforeUnloadWarning';
import { LeaveReviewModal } from './components/LeaveReviewModal';

// Initialize auth before React renders — ensures onAuthStateChange fires
// before any component tries to make Supabase queries.
AuthManager.init();

/** /video/{slug}/edit — the editor form of a video URL (auth required) */
const VIDEO_EDIT_PATH = /^\/video\/[^/]+\/edit\/?$/;

// Routes that don't require authentication. /video/{slug}(/view) is the
// public viewer; its /edit form is the editor and needs auth.
function isPublicRoute(path: string) {
    if (path.startsWith('/video/')) return !VIDEO_EDIT_PATH.test(path);
    return path === '/uninstall' || path === '/accept-invite';
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

        // Hidden admin page (impersonation) — auth-required; the server
        // 403s non-admins
        if (path === '/admin') {
            return <AdminPage />;
        }

        // Settings renders inside the dashboard layout; legacy tab paths
        // (/workspace/settings/members|billing) deep-link to a section.
        if (path.startsWith('/workspace/settings')) {
            return <DashboardPage showSettings />;
        }

        if (path === '/import' || path.startsWith('/import')) {
            return <ImportPage />;
        }

        // Legacy editor URL (/editor?projectId=…) — the editor redirects
        // to /video/{slug}/edit after loading
        if (path === '/editor' || path.startsWith('/editor')) {
            return <EditorPage />;
        }

        if (VIDEO_EDIT_PATH.test(path)) {
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
            {/* Loud on every page while impersonating (admin feature) */}
            <ImpersonationBanner />
            {/* Global host — its triggers live on transient surfaces */}
            <LeaveReviewModal />
        </ToastProvider>
    );
}
