import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LuImage, LuTrash2 } from 'react-icons/lu';
import { CloudProjectService, toShareMeta, type ProjectListItem } from '../../storage/cloudProjectService';
import { ShareModal } from '../../share/ShareModal';
import { useProjectMetaStore } from '../../share/useProjectMetaStore';
import { ProjectCard } from './ProjectCard';
import { DashboardSidebar, type DashboardView } from './DashboardSidebar';
import { deriveLibraryCounts } from './libraryCounts';
import { ScreenshotsView } from './ScreenshotsView';
import { ScreenshotService, toScreenshotMeta, type ScreenshotListItem } from '../../screenshot/screenshotService';
import { ScreenshotStorage } from '../../screenshot/api/screenshotStorage';
import { useScreenshotMetaStore } from '../../screenshot/store/useScreenshotMetaStore';
import { ScreenshotShareModal } from '../../screenshot/components/ScreenshotShareModal';
import { screenshotEditPath, screenshotUrl, screenshotViewPath } from '../../lib/screenshotUrls';
import { DashboardHeader, type ContentKind, type SortOrder } from './DashboardHeader';
import { WorkspaceSettingsPage } from '../settings/WorkspaceSettingsPage';
import { PersonalSettingsPage } from '../settings/personal/PersonalSettingsPage';
import { usePersonalDefaultsStore } from '../settings/personal/usePersonalDefaultsStore';
import { XButton, Modal, Button } from '@shared/components';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';

import { useUserStore } from '../../auth/useUserStore';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useEntitlements } from '../../billing/useEntitlements';
import { ProUpgradeModal } from '../../billing/ProUpgradeModal';
import { AuthManager } from '../../auth/AuthManager';
import { invokeFunction } from '../../api/client';
import { switchWorkspace } from '../../workspace/switchWorkspace';

import { SupportModal } from '../../components/SupportModal';
import { AuthModal } from '../../auth/AuthModal';
import { useToast } from '../../components/Toast';
import { trackProjectOpened, trackDashboardPageLoaded, trackProjectDeleteFailed, trackNewRecordingClicked } from '../../analytics';
import { captureError } from '../../lib/sentry';

import { navigate } from '../../lib/navigate';
import { editorPath, viewPath } from '../../lib/videoUrls';

/**
 * `settingsPage` renders a settings page in the content area (same sidebar):
 * 'workspace' = workspace settings, 'personal' = the user's default project
 * settings (plans/user-default-project-settings).
 */
export function DashboardPage({ settingsPage }: { settingsPage?: 'workspace' | 'personal' }) {
    const showSettings = settingsPage !== undefined;
    const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
    const [allScreenshots, setAllScreenshots] = useState<ScreenshotListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [screenshotsLoading, setScreenshotsLoading] = useState(true);
    // `?view=` deep-links a library view — how the pulled-out nav (NavDrawer)
    // gets here from the editor or the watch page, which aren't routes.
    const [activeView, setActiveView] = useState<DashboardView>(() => {
        const view = new URLSearchParams(window.location.search).get('view');
        return view === 'workspace' || view === 'trash' ? view : 'all';
    });

    const goToView = (view: DashboardView) => {
        if (view === 'settings') {
            navigate('/workspace/settings');
            return;
        }
        if (view === 'personal') {
            navigate('/settings/personal');
            return;
        }
        setActiveView(view);
        if (showSettings) navigate('/');
    };

    // Leaving the personal settings page with unsaved defaults asks first
    const [pendingView, setPendingView] = useState<DashboardView | null>(null);
    const handleViewChange = (view: DashboardView) => {
        if (settingsPage === 'personal' && view !== 'personal' && usePersonalDefaultsStore.getState().isDirty) {
            setPendingView(view);
            return;
        }
        goToView(view);
    };
    const discardAndGo = () => {
        const view = pendingView;
        setPendingView(null);
        if (!view) return;
        usePersonalDefaultsStore.getState().setDirty(false);
        goToView(view);
    };

    const { userId } = useUserStore();
    const entitlements = useEntitlements();
    const {
        workspaceId, workspaceName, workspaceRole,
        workspaceList, workspaceReady, setWorkspace, setWorkspaceList,
    } = useWorkspaceStore();

    // Split into active and trashed
    const projects = useMemo(() => allProjects.filter(p => !p.deletedAt), [allProjects]);
    // Your Videos — owned by the caller or shared with them directly (project_editors)
    const yourProjects = useMemo(
        () => projects.filter(p => p.ownerId === userId || p.isEditor),
        [projects, userId],
    );
    // Workspace — videos shared to the whole workspace or publicly
    const workspaceProjects = useMemo(
        () => projects.filter(p => p.sharePolicy === 'workspace' || p.sharePolicy === 'public'),
        [projects],
    );
    // Trash only shows the caller's own trashed videos
    const trashProjects = useMemo(
        () => allProjects.filter(p => !!p.deletedAt && p.ownerId === userId),
        [allProjects, userId],
    );

    // Screenshots (plans/screenshots) split the same way as videos:
    // Yours = own; Workspace = shared to the workspace or publicly; Trash = own trashed
    const screenshots = useMemo(() => allScreenshots.filter(s => !s.deletedAt), [allScreenshots]);
    const yourScreenshots = useMemo(
        () => screenshots.filter(s => s.ownerId === userId),
        [screenshots, userId],
    );
    const workspaceScreenshots = useMemo(
        () => screenshots.filter(s => s.sharePolicy === 'workspace' || s.sharePolicy === 'public'),
        [screenshots],
    );
    const trashScreenshots = useMemo(
        () => allScreenshots.filter(s => !!s.deletedAt && s.ownerId === userId),
        [allScreenshots, userId],
    );

    const isAuthenticated = !!userId;
    const [memberCount, setMemberCount] = useState<number | null>(null);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const { addToast } = useToast();
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);
    const [showRestoreUpgradeModal, setShowRestoreUpgradeModal] = useState(false);
    const [showShareUpgradeModal, setShowShareUpgradeModal] = useState(false);
    /** Project whose share settings are open (owner-only card menu action) */
    const [shareTarget, setShareTarget] = useState<ProjectListItem | null>(null);
    /** Screenshot whose share settings are open */
    const [screenshotShareTarget, setScreenshotShareTarget] = useState<ScreenshotListItem | null>(null);

    // Sort, filter, search state (persisted to localStorage)
    const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
        const saved = localStorage.getItem('dashboard_sort_order');
        if (saved === 'last_created' || saved === 'last_updated' || saved === 'longest' || saved === 'shortest') {
            return saved;
        }
        return 'last_created';
    });
    const [searchQuery, setSearchQuery] = useState('');
    // Videos / Screenshots selector — shared by Yours, Workspace and Trash
    const [activeKind, setActiveKind] = useState<ContentKind>('videos');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const selectMode = selectedIds.size > 0;
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    const handleRecord = () => {
        trackNewRecordingClicked(workspaceId);
        window.open(CHROME_EXTENSION_URL, '_blank');
    };

    useEffect(() => {
        if (!showSettings) trackDashboardPageLoaded(workspaceId);

        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            addToast({ type: 'error', title: error });
        }

        const checkout = params.get('checkout');
        if (checkout === 'monthly' || checkout === 'yearly') {
            navigate('/workspace/settings/billing', { replace: true });
            return;
        }

        if (params.has('subscription-success')) {
            setShowSubscriptionSuccess(true);
        }

        if (error || params.has('subscription-success') || params.has('view')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('error');
            url.searchParams.delete('subscription-success');
            // Consumed into activeView above — don't leave it pinned in the URL
            url.searchParams.delete('view');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
    }, []);

    // Load projects once auth is ready and workspace is resolved
    useEffect(() => {
        if (!isAuthenticated || !workspaceId) return;

        const ctrl = { cancelled: false };
        (async () => {
            try {
                await AuthManager.ready;
                if (ctrl.cancelled) return;
                const loaded = await CloudProjectService.listProjects(workspaceId);
                if (!ctrl.cancelled) {
                    setAllProjects(loaded);
                    // Load thumbnails AFTER setting state so callbacks patch the correct array
                    CloudProjectService.loadThumbnails(loaded, (projectId, thumbnailUrl) => {
                        if (!ctrl.cancelled) {
                            setAllProjects(prev => prev.map(p =>
                                p.id === projectId ? { ...p, thumbnail: thumbnailUrl } : p
                            ));
                        }
                    });
                }
            } catch (error) {
                if (!ctrl.cancelled) captureError(error, { flow: 'dashboard_load', workspaceId });
            } finally {
                if (!ctrl.cancelled) setLoading(false);
            }
        })();

        return () => { ctrl.cancelled = true; };
    }, [isAuthenticated, workspaceId]);

    // Screenshots load alongside projects (plans/screenshots Step 11)
    useEffect(() => {
        if (!isAuthenticated || !workspaceId) return;

        const ctrl = { cancelled: false };
        setScreenshotsLoading(true);
        (async () => {
            try {
                await AuthManager.ready;
                if (ctrl.cancelled) return;
                const loaded = await ScreenshotService.listScreenshots(workspaceId);
                if (!ctrl.cancelled) {
                    setAllScreenshots(loaded);
                    ScreenshotService.loadThumbnails(loaded, (screenshotId, thumbnailUrl) => {
                        if (!ctrl.cancelled) {
                            setAllScreenshots(prev => prev.map(s =>
                                s.id === screenshotId ? { ...s, thumbnail: thumbnailUrl } : s
                            ));
                        }
                    });
                }
            } catch (error) {
                if (!ctrl.cancelled) captureError(error, { flow: 'dashboard_screenshots_load', workspaceId });
            } finally {
                if (!ctrl.cancelled) setScreenshotsLoading(false);
            }
        })();

        return () => { ctrl.cancelled = true; };
    }, [isAuthenticated, workspaceId]);

    // View-filtered base lists — one per kind so the tab counts stay accurate
    const isTrash = activeView === 'trash';
    const viewProjects = useMemo(() => {
        if (isTrash) return trashProjects;
        if (activeView === 'workspace') return workspaceProjects;
        return yourProjects;
    }, [activeView, isTrash, yourProjects, workspaceProjects, trashProjects]);
    const viewScreenshots = useMemo(() => {
        if (isTrash) return trashScreenshots;
        if (activeView === 'workspace') return workspaceScreenshots;
        return yourScreenshots;
    }, [activeView, isTrash, yourScreenshots, workspaceScreenshots, trashScreenshots]);

    // Data pipeline: search → sort (trash is always most recently deleted first)
    const query = searchQuery.trim().toLowerCase();
    const hasSearch = query.length > 0;
    const searchedProjects = useMemo(
        () => query ? viewProjects.filter(p => p.name.toLowerCase().includes(query)) : viewProjects,
        [viewProjects, query],
    );
    const searchedScreenshots = useMemo(
        () => query ? viewScreenshots.filter(s => s.name.toLowerCase().includes(query)) : viewScreenshots,
        [viewScreenshots, query],
    );

    const byDeletedAt = <T extends { deletedAt: string | null }>(a: T, b: T) =>
        new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime();

    const sortedProjects = useMemo(() => {
        const sorted = [...searchedProjects];
        if (isTrash) return sorted.sort(byDeletedAt);
        switch (sortOrder) {
            case 'last_created':
                sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
            case 'last_updated':
                sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                break;
            case 'longest':
                sorted.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
                break;
            case 'shortest':
                sorted.sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
                break;
        }
        return sorted;
    }, [searchedProjects, sortOrder, isTrash]);

    // Screenshots have no duration: the duration sorts fall back to creation time
    const sortedScreenshots = useMemo(() => {
        const sorted = [...searchedScreenshots];
        if (isTrash) return sorted.sort(byDeletedAt);
        if (sortOrder === 'last_updated') {
            return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        }
        return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [searchedScreenshots, sortOrder, isTrash]);

    // Sidebar numbers — same derivation the pulled-out nav uses, so the two
    // can't disagree about what Yours/Workspace/Trash mean
    const sidebarCounts = useMemo(
        () => deriveLibraryCounts(allProjects, allScreenshots, userId),
        [allProjects, allScreenshots, userId],
    );

    // Load the full workspace list once authenticated
    useEffect(() => {
        if (!isAuthenticated) return;
        invokeFunction('workspace-list', {}).then(({ data, error }) => {
            if (!error && data) setWorkspaceList(data.workspaces);
        });
    }, [isAuthenticated]);

    // Member count for the sidebar workspace card
    useEffect(() => {
        setMemberCount(null);
        if (!isAuthenticated || !workspaceId) return;
        let cancelled = false;
        invokeFunction('workspace-get', { workspaceId }).then(({ data, error }) => {
            if (!cancelled && !error && data) setMemberCount(data.members.length);
        });
        return () => { cancelled = true; };
    }, [isAuthenticated, workspaceId]);

    const handleSwitchWorkspace = async (newWorkspaceId: string) => {
        const ws = workspaceList.find(w => w.id === newWorkspaceId);
        if (!ws) return;
        await switchWorkspace(ws, userId);
        // Projects reload automatically via the workspaceId effect
    };

    const handleOpen = (item: ProjectListItem) => {
        trackProjectOpened();
        if (!item.shareSlug) {
            // Defensive: pre-migration row without a slug
            navigate(`/editor?projectId=${item.id}`);
            return;
        }
        // Permission-aware: only viewers with edit access land in the editor
        const sharedToWorkspace = item.sharePolicy === 'workspace' || item.sharePolicy === 'public';
        const canEdit = item.ownerId === userId
            || item.editorRole === 'edit'
            || (sharedToWorkspace && item.workspaceAccess === 'edit');
        navigate(canEdit ? editorPath(item.shareSlug) : viewPath(item.shareSlug));
    };

    // Share settings from the card menu (owner-only; free tier gets the
    // upgrade modal, server enforces regardless). The modal reads from
    // useProjectMetaStore — hydrate it via project-get first.
    const handleShareSettings = async (item: ProjectListItem) => {
        if (!entitlements.canShare) {
            setShowShareUpgradeModal(true);
            return;
        }
        const { data, error } = await invokeFunction('project-get', { projectId: item.id });
        if (error || !data) {
            addToast({ type: 'error', title: 'Failed to load share settings' });
            return;
        }
        useProjectMetaStore.getState().setMeta(toShareMeta(data));
        setShareTarget(item);
    };

    const closeShareModal = () => {
        setShareTarget(null);
        // Reflect any policy/access change on the card (visibility glyph + copy-link)
        const m = useProjectMetaStore.getState().meta;
        if (m) {
            setAllProjects(prev => prev.map(p => p.id === m.id
                ? { ...p, sharePolicy: m.sharePolicy, workspaceAccess: m.workspaceAccess }
                : p));
        }
    };

    // ─── Screenshot actions (plans/screenshots Step 11) ───────────

    const handleOpenScreenshot = (item: ScreenshotListItem) => {
        const sharedToWorkspace = item.sharePolicy === 'workspace' || item.sharePolicy === 'public';
        const canEdit = item.ownerId === userId
            || (sharedToWorkspace && item.workspaceAccess === 'edit' && workspaceRole !== 'viewer');
        navigate(canEdit ? screenshotEditPath(item.slug) : screenshotViewPath(item.slug));
    };

    const handleScreenshotShareSettings = async (item: ScreenshotListItem) => {
        if (!entitlements.canShare) {
            setShowShareUpgradeModal(true);
            return;
        }
        try {
            const row = await ScreenshotStorage.get({ screenshotId: item.id });
            if (!row) throw new Error('Screenshot not found');
            useScreenshotMetaStore.getState().setMeta(toScreenshotMeta(row));
            setScreenshotShareTarget(item);
        } catch {
            addToast({ type: 'error', title: 'Failed to load share settings' });
        }
    };

    const closeScreenshotShareModal = () => {
        setScreenshotShareTarget(null);
        const m = useScreenshotMetaStore.getState().meta;
        if (m) {
            setAllScreenshots(prev => prev.map(s => s.id === m.id
                ? { ...s, sharePolicy: m.sharePolicy, workspaceAccess: m.workspaceAccess }
                : s));
        }
        useScreenshotMetaStore.getState().clear();
    };

    const handleRenameScreenshot = async (screenshotId: string, newName: string) => {
        try {
            await ScreenshotService.renameScreenshot(screenshotId, newName);
            setAllScreenshots(prev => prev.map(s => (s.id === screenshotId ? { ...s, name: newName } : s)));
        } catch (err) {
            captureError(err, { flow: 'screenshot', phase: 'rename', extra: { screenshotId } });
            addToast({ type: 'error', title: 'Failed to rename screenshot' });
        }
    };

    const handleDeleteScreenshot = async (screenshotId: string) => {
        try {
            await ScreenshotService.deleteScreenshot(screenshotId);
            const now = new Date().toISOString();
            setAllScreenshots(prev => prev.map(s => (s.id === screenshotId ? { ...s, deletedAt: now } : s)));
            addToast({ type: 'success', title: 'Moved to Trash' });
        } catch (err) {
            captureError(err, { flow: 'screenshot', phase: 'delete', extra: { screenshotId } });
            addToast({ type: 'error', title: 'Failed to delete screenshot' });
        }
    };

    const handleRestoreScreenshot = async (screenshotId: string) => {
        if (!entitlements.canRestore) {
            setShowRestoreUpgradeModal(true);
            return;
        }
        try {
            const ok = await ScreenshotService.restoreScreenshot(screenshotId);
            if (ok) {
                setAllScreenshots(prev => prev.map(s => (s.id === screenshotId ? { ...s, deletedAt: null } : s)));
                addToast({ type: 'success', title: 'Screenshot restored' });
            }
        } catch (err) {
            captureError(err, { flow: 'screenshot', phase: 'restore', extra: { screenshotId } });
            addToast({ type: 'error', title: 'Failed to restore screenshot' });
        }
    };

    // Restore from trash — the button always presses; free tier gets the
    // upgrade modal instead (server enforces canRestore regardless)
    const handleRestore = async (projectId: string) => {
        if (!entitlements.canRestore) {
            setShowRestoreUpgradeModal(true);
            return;
        }
        const ok = await CloudProjectService.restoreProject(projectId);
        if (ok) {
            setAllProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, deletedAt: null } : p
            ));
            addToast({ type: 'success', title: 'Project restored' });
        }
    };

    // Rename project
    const handleRename = async (projectId: string, newName: string) => {
        try {
            await CloudProjectService.renameProject(projectId, newName);
            setAllProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, name: newName } : p
            ));
        } catch (err) {
            captureError(err, { flow: 'project', phase: 'rename', projectId });
            addToast({ type: 'error', title: 'Failed to rename project' });
        }
    };

    // Delete single project (move to trash)
    const handleDelete = async (projectId: string) => {
        try {
            await CloudProjectService.deleteProject(projectId);
            const now = new Date().toISOString();
            setAllProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, deletedAt: now } : p
            ));
            addToast({ type: 'success', title: 'Moved to Trash' });
        } catch (err: any) {
            captureError(err, { flow: 'project', phase: 'delete', projectId });
            trackProjectDeleteFailed({
                project_id: projectId,
                error: err?.message || 'Unknown error',
                error_name: err?.name,
                is_offline: !navigator.onLine,
            });
            addToast({ type: 'error', title: 'Failed to delete project' });
        }
    };

    // Bulk delete
    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        const count = selectedIds.size;
        try {
            for (const id of selectedIds) {
                await CloudProjectService.deleteProject(id);
            }
            // Mark as trashed in local state (soft delete sets deleted_at)
            const now = new Date().toISOString();
            setAllProjects(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, deletedAt: now } : p
            ));
            setSelectedIds(new Set());
            setShowBulkDeleteModal(false);
            addToast({ type: 'success', title: 'Moved to Trash', message: `${count} project${count !== 1 ? 's' : ''} moved to trash` });
        } catch (error: any) {
            captureError(error, { flow: 'project', phase: 'bulk_delete', extra: { count } });
            trackProjectDeleteFailed({
                count,
                error: error?.message || 'Unknown error',
                error_name: error?.name,
                is_offline: !navigator.onLine,
            });
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const exitSelectMode = () => {
        setSelectedIds(new Set());
    };

    if (isAuthenticated && !workspaceReady) return null;

    return (
        <div className="h-screen bg-surface-body text-text-main flex flex-col">
            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <DashboardSidebar
                    activeView={settingsPage === 'personal' ? 'personal' : showSettings ? 'settings' : activeView}
                    onViewChange={handleViewChange}
                    yoursCount={sidebarCounts.yoursCount}
                    workspaceCount={sidebarCounts.workspaceCount}
                    ownedProjectCount={sidebarCounts.ownedProjectCount}
                    projectCap={entitlements.projectCap}
                    ownedScreenshotCount={sidebarCounts.ownedScreenshotCount}
                    screenshotCap={entitlements.screenshotCap}
                    trashCount={sidebarCounts.trashCount}
                    onRecord={handleRecord}
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
                    onInviteTeammates={() => navigate('/workspace/settings#members')}
                    onOpenBilling={() => navigate('/workspace/settings#billing')}
                />

                {/* Main Content */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {settingsPage === 'personal' ? (
                        // bounded height: the editor-like card scrolls its own settings column
                        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden p-6">
                            <PersonalSettingsPage />
                            <Modal
                                isOpen={pendingView !== null}
                                onClose={() => setPendingView(null)}
                                maxWidth="max-w-[420px]"
                                ariaLabel="Discard unsaved defaults"
                            >
                                <h2 className="heading-2 mb-2">Discard unsaved defaults?</h2>
                                <p className="text-sm text-text-main mb-6">
                                    Your changes to the default settings haven’t been saved.
                                </p>
                                <div className="flex justify-end gap-2">
                                    <Button variant="base" onClick={() => setPendingView(null)}>Keep editing</Button>
                                    <Button variant="destructive" onClick={discardAndGo}>Discard</Button>
                                </div>
                            </Modal>
                        </main>
                    ) : showSettings ? (
                        <main className="flex-1 overflow-y-auto p-8">
                            <WorkspaceSettingsPage />
                        </main>
                    ) : (
                        <>
                            <DashboardHeader
                                searchQuery={searchQuery}
                                onSearchChange={setSearchQuery}
                                activeKind={activeKind}
                                onKindChange={setActiveKind}
                                videoCount={searchedProjects.length}
                                screenshotCount={searchedScreenshots.length}
                                sortOrder={sortOrder}
                                onSortChange={setSortOrder}
                                showSort={!isTrash}
                            />

                            <main className="flex-1 overflow-y-auto p-6">
                                {isTrash && (
                                    <p className="text-sm text-text-muted mb-6">
                                        Videos and screenshots in trash are permanently deleted after 30 days.
                                    </p>
                                )}
                                {activeKind === 'screenshots' && !isTrash ? (
                                    <ScreenshotsView
                                        items={sortedScreenshots}
                                        loading={screenshotsLoading}
                                        filtered={hasSearch}
                                        userId={userId}
                                        showUpdatedAt={sortOrder === 'last_updated'}
                                        onOpen={handleOpenScreenshot}
                                        onRename={handleRenameScreenshot}
                                        onDelete={handleDeleteScreenshot}
                                        onShare={item => void handleScreenshotShareSettings(item)}
                                    />
                                ) : activeKind === 'screenshots' ? (
                                    /* Trash — screenshots */
                                    screenshotsLoading ? (
                                        <div className="flex items-center justify-center h-64">
                                            <div className="text-text-muted">Loading screenshots...</div>
                                        </div>
                                    ) : sortedScreenshots.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                                            <LuTrash2 size={40} className="text-text-muted/50" />
                                            <p className="text-sm text-text-muted">
                                                {hasSearch ? 'No screenshots match your search.' : 'No screenshots in trash'}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                                            {sortedScreenshots.map(item => (
                                                <ProjectCard
                                                    key={item.id}
                                                    variant="grid"
                                                    project={{
                                                        id: item.id,
                                                        name: item.name,
                                                        thumbnail: item.thumbnail,
                                                        createdAt: item.createdAt,
                                                        deletedAt: item.deletedAt,
                                                    }}
                                                    shareUrl={screenshotUrl(item.slug)}
                                                    badge={<LuImage className="icon-sm" aria-label="Screenshot" />}
                                                    onOpen={() => {}}
                                                    onRestore={() => handleRestoreScreenshot(item.id)}
                                                />
                                            ))}
                                        </div>
                                    )
                                ) : loading ? (
                                    <div className="flex items-center justify-center h-64">
                                        <div className="text-text-muted">Loading projects...</div>
                                    </div>
                                ) : sortedProjects.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        {isTrash && <LuTrash2 size={40} className="text-text-muted/50" />}
                                        <p className="text-sm text-text-muted">
                                            {hasSearch
                                                ? 'No recordings match your search.'
                                                : isTrash
                                                    ? 'No videos in trash'
                                                    : <>Use the <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">Recordio extension</a> to start a new project.</>
                                            }
                                        </p>
                                    </div>
                                ) : isTrash ? (
                                    /* Trash — videos */
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                                        {sortedProjects.map(item => (
                                            <ProjectCard
                                                key={item.id}
                                                variant="grid"
                                                project={{
                                                    id: item.id,
                                                    name: item.name,
                                                    thumbnail: item.thumbnail,
                                                    createdAt: item.createdAt,
                                                    durationMs: item.durationMs,
                                                    deletedAt: item.deletedAt,
                                                }}
                                                onOpen={() => {}}
                                                onRestore={() => handleRestore(item.id)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                                        {sortedProjects.map((item: ProjectListItem) => (
                                            <ProjectCard
                                                key={item.id}
                                                variant="grid"
                                                project={{
                                                    id: item.id,
                                                    name: item.name,
                                                    thumbnail: item.thumbnail,
                                                    createdAt: item.createdAt,
                                                    updatedAt: item.updatedAt,
                                                    durationMs: item.durationMs,
                                                    shareSlug: item.shareSlug,
                                                    sharePolicy: item.sharePolicy,
                                                    sharedWithMe: !!item.editorRole && item.ownerId !== userId,
                                                }}
                                                onOpen={() => handleOpen(item)}
                                                selectMode={selectMode}
                                                selected={selectedIds.has(item.id)}
                                                onSelect={() => toggleSelect(item.id)}
                                                onRename={handleRename}
                                                onDelete={handleDelete}
                                                onShare={item.ownerId === userId
                                                    ? () => void handleShareSettings(item)
                                                    : undefined}
                                                showUpdatedAt={sortOrder === 'last_updated'}
                                            />
                                        ))}
                                    </div>
                                )}
                            </main>
                        </>
                    )}
                </div>
            </div>

            {/* Floating Action Bar — Select Mode */}
            {selectMode && createPortal(
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-index-overlay)] animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="flex items-center gap-3 bg-surface-raised border border-border rounded-xl px-5 py-3 shadow-float">
                        <span className="text-sm text-text-highlighted">
                            {selectedIds.size} selected
                        </span>
                        <div className="w-px h-5 bg-border" />
                        <Button
                            variant="ghost"
                            onClick={() => {
                                const allIds = sortedProjects.map(p => p.id);
                                if (selectedIds.size === allIds.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(allIds));
                                }
                            }}
                        >
                            {selectedIds.size === sortedProjects.length ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => setShowBulkDeleteModal(true)}
                            disabled={isBulkDeleting}
                        >
                            Delete
                        </Button>
                        <Button
                            onClick={exitSelectMode}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>,
                document.body
            )}

            <ProUpgradeModal
                isOpen={showRestoreUpgradeModal}
                onClose={() => setShowRestoreUpgradeModal(false)}
                feature="restoring deleted videos"
                reason="restore"
            />
            <ProUpgradeModal
                isOpen={showShareUpgradeModal}
                onClose={() => setShowShareUpgradeModal(false)}
                feature="publishing"
                reason="share"
            />
            <ShareModal
                isOpen={!!shareTarget}
                onClose={closeShareModal}
                projectName={shareTarget?.name ?? ''}
            />
            <ScreenshotShareModal
                isOpen={!!screenshotShareTarget}
                onClose={closeScreenshotShareModal}
            />
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />
            {/* Bulk Delete Confirmation Modal */}
            {showBulkDeleteModal && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[var(--z-index-modal)] backdrop-blur-sm p-4">
                    <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="heading-2">Delete Projects</h2>
                            <XButton
                                onClick={() => setShowBulkDeleteModal(false)}
                                title="Close"
                            />
                        </div>

                        <p className="text-sm text-text-main mb-6">
                            Are you sure you want to delete <span className="text-text-highlighted">{selectedIds.size}</span> project{selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
                        </p>

                        <div className="flex gap-3 justify-end">
                            <Button
                                onClick={() => setShowBulkDeleteModal(false)}
                                disabled={isBulkDeleting}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleBulkDelete}
                                disabled={isBulkDeleting}
                            >
                                {isBulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
                            </Button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Subscription Success Modal */}
            <Modal isOpen={showSubscriptionSuccess} onClose={() => setShowSubscriptionSuccess(false)} maxWidth="max-w-[400px]" className="text-center">
                <div className="text-4xl mb-4">🎉</div>
                <h2 className="heading-2 mb-2">Welcome to Pro!</h2>
                <p className="text-sm text-text-main mb-6">
                    Your subscription is now active. Enjoy unlimited exports, publishing, and all Pro features.
                </p>
                <Button
                    variant="primary"
                    fullWidth
                    onClick={() => setShowSubscriptionSuccess(false)}
                >
                    Get Started
                </Button>
            </Modal>

        </div>
    );
}
