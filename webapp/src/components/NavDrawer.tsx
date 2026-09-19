import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuPanelLeftOpen } from 'react-icons/lu';
import { Button } from '@shared/components';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { LogoLink } from '@shared/components/LogoLink';

import { DashboardSidebar, type DashboardView } from '../pages/dashboard/DashboardSidebar';
import { deriveLibraryCounts, type LibraryCounts } from '../pages/dashboard/libraryCounts';
import { CloudProjectService } from '../storage/cloudProjectService';
import { ScreenshotService } from '../screenshot/screenshotService';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useEntitlements } from '../billing/useEntitlements';
import { switchWorkspace } from '../workspace/switchWorkspace';
import { AuthManager } from '../auth/AuthManager';
import { invokeFunction } from '../api/client';
import { navigate } from '../lib/navigate';
import { captureError } from '../lib/sentry';
import { trackNewRecordingClicked } from '../analytics';
import { SupportModal } from './SupportModal';
import { AuthModal } from '../auth/AuthModal';
import { useNavDrawerStore } from './useNavDrawerStore';

/**
 * The button that pulls the main nav out over the current page: panel glyph +
 * logo, mirroring the collapsed sidebar on the dashboard.
 *
 * `onOpen` is the caller's, not the store's, because each host has something to
 * do first — the editor and the watch page both pause playback before the
 * backdrop dims their player.
 */
export function NavDrawerToggle({ onOpen }: { onOpen: () => void }) {
    return (
        <div className="flex items-center gap-2 shrink-0">
            <Button
                variant="ghost"
                icon={LuPanelLeftOpen}
                onClick={onOpen}
                aria-label="Open navigation"
                title="Open navigation"
            />
            <LogoLink imgClassName="h-6" />
        </div>
    );
}

/**
 * The dashboard's main side panel, pulled out over a page that doesn't own it
 * (the editor, the watch page). Dims and blocks everything behind it.
 *
 * Its counts need the project and screenshot lists, which those pages never
 * load, so the two list calls fire on first open and not before — the numbers
 * and the free-plan usage meters stay hidden until they land rather than
 * flashing zeroes.
 *
 * Sits below the 9999 layer so the workspace and account menus inside it, and
 * any modal it opens, still stack above.
 */
export function NavDrawer() {
    const isOpen = useNavDrawerStore(s => s.isOpen);
    const close = useNavDrawerStore(s => s.close);

    const { userId, isAuthenticated } = useUserStore();
    const entitlements = useEntitlements();
    const {
        workspaceId, workspaceName, workspaceRole,
        workspaceList, setWorkspaceList,
    } = useWorkspaceStore();

    // Both are tagged with the workspace they describe, so a workspace switch
    // reads as "not loaded yet" without an effect resetting state on the way in
    const [loaded, setLoaded] = useState<{ workspaceId: string; counts: LibraryCounts } | null>(null);
    const counts = loaded?.workspaceId === workspaceId ? loaded.counts : null;
    const [members, setMembers] = useState<{ workspaceId: string; count: number } | null>(null);
    const memberCount = members?.workspaceId === workspaceId ? members.count : null;

    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    // Esc closes, like the modals
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, close]);

    // Counts — the two list calls the host page never makes. Fires on open (not
    // before) and again when the workspace changes, since switching happens
    // from inside this panel.
    useEffect(() => {
        if (!isOpen || !isAuthenticated || !workspaceId) return;

        const ctrl = { cancelled: false };
        (async () => {
            try {
                await AuthManager.ready;
                if (ctrl.cancelled) return;
                const [projects, screenshots] = await Promise.all([
                    CloudProjectService.listProjects(workspaceId),
                    ScreenshotService.listScreenshots(workspaceId),
                ]);
                if (ctrl.cancelled) return;
                setLoaded({ workspaceId, counts: deriveLibraryCounts(projects, screenshots, userId) });
            } catch (error) {
                if (!ctrl.cancelled) captureError(error, { flow: 'nav_drawer_counts', workspaceId });
            }
        })();

        return () => { ctrl.cancelled = true; };
    }, [isOpen, isAuthenticated, workspaceId, userId]);

    // Workspace list + member count for the workspace card
    useEffect(() => {
        if (!isOpen || !isAuthenticated) return;
        invokeFunction('workspace-list', {}).then(({ data, error }) => {
            if (!error && data) setWorkspaceList(data.workspaces);
        });
    }, [isOpen, isAuthenticated, setWorkspaceList]);

    useEffect(() => {
        if (!isOpen || !isAuthenticated || !workspaceId) return;
        let cancelled = false;
        invokeFunction('workspace-get', { workspaceId }).then(({ data, error }) => {
            if (!cancelled && !error && data) setMembers({ workspaceId, count: data.members.length });
        });
        return () => { cancelled = true; };
    }, [isOpen, isAuthenticated, workspaceId]);

    const goTo = (path: string) => {
        close();
        navigate(path);
    };

    // The dashboard's library views aren't routes — `?view=` deep-links them so
    // "Trash" from the editor actually lands on Trash.
    const handleViewChange = (view: DashboardView) => {
        if (view === 'settings') return goTo('/workspace/settings');
        if (view === 'personal') return goTo('/settings/personal');
        goTo(`/?view=${view}`);
    };

    const handleSwitchWorkspace = async (newWorkspaceId: string) => {
        const ws = workspaceList.find(w => w.id === newWorkspaceId);
        if (!ws) return;
        await switchWorkspace(ws, userId);
        // Counts reload via the workspaceId effect
    };

    // Like the app's other overlays: animated in, removed outright on close
    if (!isOpen) return null;

    return createPortal(
        <>
            <div className="fixed inset-0 z-[9990]" role="presentation">
                {/* Dimmed page behind — clicking it closes */}
                <div onClick={close} className="absolute inset-0 bg-black/60 animate-fade-in" />
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Main navigation"
                    className="absolute inset-y-0 left-0 shadow-float animate-slide-in-left"
                >
                    <DashboardSidebar
                        inDrawer
                        onCollapse={close}
                        activeView={null}
                        onViewChange={handleViewChange}
                        yoursCount={counts?.yoursCount}
                        workspaceCount={counts?.workspaceCount}
                        trashCount={counts?.trashCount}
                        ownedProjectCount={counts?.ownedProjectCount ?? 0}
                        ownedScreenshotCount={counts?.ownedScreenshotCount ?? 0}
                        // Usage meters stay hidden until the real counts land
                        projectCap={counts ? entitlements.projectCap : null}
                        screenshotCap={counts ? entitlements.screenshotCap : null}
                        onRecord={() => {
                            trackNewRecordingClicked(workspaceId);
                            window.open(CHROME_EXTENSION_URL, '_blank');
                        }}
                        isAuthenticated={isAuthenticated}
                        onOpenSupport={() => setIsSupportModalOpen(true)}
                        onOpenAuthModal={() => setIsAuthModalOpen(true)}
                        workspaces={workspaceList}
                        currentWorkspaceId={workspaceId}
                        currentWorkspaceName={workspaceName}
                        currentRole={workspaceRole}
                        onSwitchWorkspace={handleSwitchWorkspace}
                        planState={entitlements.state}
                        memberCount={memberCount}
                        onInviteTeammates={() => goTo('/workspace/settings#members')}
                        onOpenBilling={() => goTo('/workspace/settings#billing')}
                    />
                </div>
            </div>

            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
        </>,
        document.body,
    );
}
