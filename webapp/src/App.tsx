import { useState, useEffect } from 'react';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { ScreenshotEditorPage } from './pages/ScreenshotEditorPage';
import { ScreenshotViewPage } from './pages/ScreenshotViewPage';
import { SCREENSHOT_EDIT_PATH } from './lib/screenshotUrls';
import { ImportPage } from './pages/import/ImportPage';
import { VideoPage } from './pages/VideoPage';
import { UninstallPage } from './pages/UninstallPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { AdminPage } from './pages/admin/AdminPage';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import { ToastProvider } from './components/Toast';
import { AuthManager } from './auth/AuthManager';
import { AuthPage } from './auth/AuthPage';
import { AuthUnreachableModal } from './auth/AuthUnreachableModal';
import { useUserStore } from './auth/useUserStore';
import { useAuthStatusStore } from './auth/useAuthStatusStore';
import { LeaveReviewModal } from './components/LeaveReviewModal';
import { ActivityToasts } from './activity/ActivityToasts';

// Initialize auth before React renders — ensures onAuthStateChange fires
// before any component tries to make Supabase queries.
AuthManager.init();

/** /video/{slug}/edit — the editor form of a video URL (auth required) */
const VIDEO_EDIT_PATH = /^\/video\/[^/]+\/edit\/?$/;

/**
 * Routes App gates itself: signed out they render the full sign-in page
 * instead — the dashboard never mounts and never fetches. Everything else
 * is either public (/video/{slug},
 * /uninstall, /accept-invite) or prompts for auth on its own at the right
 * moment: the editor blocks on its own sign-in screen once the project
 * load needs a session, and /import has to keep running while signed out
 * so it can receive the extension's blobs before asking to sign in.
 */
function isGatedRoute(path: string) {
    if (path.startsWith('/video/')) return false;
    // Screenshots (plans/screenshots): the editor prompts for auth itself,
    // the view page is public
    if (path.startsWith('/screenshot/')) return false;
    if (path.startsWith('/editor')) return false;
    if (path.startsWith('/import')) return false;
    return path !== '/uninstall' && path !== '/accept-invite';
}

export function App() {
    const [path, setPath] = useState(window.location.pathname);
    const [authReady, setAuthReady] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);
    const authServerUnreachable = useAuthStatusStore(s => s.authServerUnreachable);

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
            return <DashboardPage settingsPage="workspace" />;
        }

        // Personal (per-user) settings — defaults for new projects
        // (plans/user-default-project-settings); same dashboard layout.
        if (path.startsWith('/settings/personal')) {
            return <DashboardPage settingsPage="personal" />;
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

        // /screenshot/{slug}/edit (editor) and /screenshot/{slug} (public view)
        if (SCREENSHOT_EDIT_PATH.test(path)) {
            return <ScreenshotEditorPage />;
        }

        if (path.startsWith('/screenshot/')) {
            return <ScreenshotViewPage />;
        }

        // Default to dashboard
        return <DashboardPage />;
    };

    const isGated = isGatedRoute(path);

    // A stored session we can't renew because the auth server is unreachable.
    // auth-js keeps that session and emits nothing, so authReady never resolves
    // while the persisted store still says we're signed in — the app would
    // otherwise render as authenticated against a dead session (a blank
    // dashboard, since it holds for workspaceReady) for the ~50s the refresh
    // retries take to give up. Signing in again wouldn't help, so this gets its
    // own modal rather than the sign-in one, and it holds once authReady
    // resolves too so the two don't flip back and forth.
    const usableSession = authReady && isAuthenticated;
    if (isGated && !usableSession && authServerUnreachable) {
        return (
            <ToastProvider>
                <div className="w-full h-screen bg-surface-body" />
                <AuthUnreachableModal />
            </ToastProvider>
        );
    }

    // Signed out on a gated route: the full sign-in page, no way out. It waits
    // for authReady so a returning session doesn't flash it; until then the
    // bare background holds, so the dashboard never shows through.
    const blocked = !isAuthenticated && isGated;

    if (blocked) {
        return (
            <ToastProvider>
                {authReady ? <AuthPage /> : <div className="w-full h-screen bg-surface-body" />}
            </ToastProvider>
        );
    }

    return (
        <ToastProvider>
            {getPage()}
            {/* Toasts for background render/upload transitions — progress
                itself shows on the editor header and the dashboard cards */}
            <ActivityToasts />
            {/* Loud on every page while impersonating (admin feature) */}
            <ImpersonationBanner />
            {/* Global host — its triggers live on transient surfaces */}
            <LeaveReviewModal />
        </ToastProvider>
    );
}
