import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LuTrash2 } from 'react-icons/lu';
import { CloudProjectService, type ProjectListItem } from '../../storage/cloudProjectService';
import { ProjectCard } from './ProjectCard';
import { DashboardSidebar, type DashboardView } from './DashboardSidebar';
import { DashboardHeader, type FilterTab, type SortOrder } from './DashboardHeader';
import { WorkspaceSettingsPage } from '../settings/WorkspaceSettingsPage';
import { XButton, Modal, Button } from '@shared/components';
import { BRIDGE_MSG, CHROME_EXTENSION_URL } from '@shared/types/bridge';

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

const EXTENSION_ID = import.meta.env.DEV
    ? 'lpponocoanighhephabalkejmdbjlhmi'
    : 'bbcdpipjplklaneplfmlhhibnllhinii';

/** `showSettings` renders the workspace settings page in the content area (same sidebar). */
export function DashboardPage({ showSettings = false }: { showSettings?: boolean }) {
    const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeView, setActiveView] = useState<DashboardView>('all');

    const handleViewChange = (view: DashboardView) => {
        if (view === 'settings') {
            navigate('/workspace/settings');
            return;
        }
        setActiveView(view);
        if (showSettings) navigate('/');
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

    const isAuthenticated = !!userId;
    const [memberCount, setMemberCount] = useState<number | null>(null);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const { addToast } = useToast();
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);
    const [showRestoreUpgradeModal, setShowRestoreUpgradeModal] = useState(false);

    // Sort, filter, search state (persisted to localStorage)
    const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
        const saved = localStorage.getItem('dashboard_sort_order');
        if (saved === 'last_created' || saved === 'last_updated' || saved === 'longest' || saved === 'shortest') {
            return saved;
        }
        return 'last_created';
    });
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const selectMode = selectedIds.size > 0;
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    const handleRecord = () => {
        trackNewRecordingClicked(workspaceId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chr = (window as any).chrome;
        if (!chr?.runtime?.sendMessage) {
            window.open(CHROME_EXTENSION_URL, '_blank');
            return;
        }
        chr.runtime.sendMessage(EXTENSION_ID, { type: BRIDGE_MSG.OPEN_CONTROLLER }, (response: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (chr.runtime.lastError || !response?.success) {
                window.open(CHROME_EXTENSION_URL, '_blank');
            }
        });
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

        if (error || params.has('subscription-success')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('error');
            url.searchParams.delete('subscription-success');
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

    // View-filtered base list
    const viewProjects = useMemo(() => {
        if (activeView === 'workspace') {
            return workspaceProjects;
        }
        if (activeView === 'published') {
            return projects.filter(p => p.shareSlug);
        }
        return yourProjects;
    }, [projects, yourProjects, workspaceProjects, activeView]);

    // Data pipeline: search → filter → sort → group
    const searchFiltered = useMemo(() => {
        if (!searchQuery.trim()) return viewProjects;
        const q = searchQuery.toLowerCase();
        return viewProjects.filter(p => p.name.toLowerCase().includes(q));
    }, [viewProjects, searchQuery]);

    const tabFiltered = useMemo(() => {
        if (activeFilter === 'under_1min') {
            return searchFiltered.filter(p => (p.durationMs ?? 0) < 60000);
        }
        return searchFiltered;
    }, [searchFiltered, activeFilter]);

    const sortedProjects = useMemo(() => {
        const sorted = [...tabFiltered];
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
    }, [tabFiltered, sortOrder]);

    // Counts for header
    const under1MinCount = useMemo(() => {
        const base = searchQuery.trim()
            ? viewProjects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : viewProjects;
        return base.filter(p => (p.durationMs ?? 0) < 60000).length;
    }, [viewProjects, searchQuery]);

    const sharedCount = useMemo(() => projects.filter(p => p.isShared).length, [projects]);

    // The free-plan cap counts the CALLER's projects, not the workspace's
    const ownedProjectCount = useMemo(
        () => projects.filter(p => p.ownerId === userId).length,
        [projects, userId],
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
        navigate(`/editor?projectId=${item.id}`);
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
                    activeView={showSettings ? 'settings' : activeView}
                    onViewChange={handleViewChange}
                    projectCount={yourProjects.length}
                    workspaceCount={workspaceProjects.length}
                    ownedProjectCount={ownedProjectCount}
                    projectCap={entitlements.projectCap}
                    trashCount={trashProjects.length}
                    publishedCount={sharedCount}
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
                    {showSettings ? (
                        <main className="flex-1 overflow-y-auto p-8">
                            <WorkspaceSettingsPage />
                        </main>
                    ) : activeView !== 'trash' ? (
                        <>
                            <DashboardHeader
                                searchQuery={searchQuery}
                                onSearchChange={setSearchQuery}
                                activeFilter={activeFilter}
                                onFilterChange={setActiveFilter}
                                totalCount={searchFiltered.length}
                                under1MinCount={under1MinCount}
                                sortOrder={sortOrder}
                                onSortChange={setSortOrder}
                            />

                        {/* Project Grid */}
                        <main className="flex-1 overflow-y-auto p-6">
                            {loading ? (
                                <div className="flex items-center justify-center h-64">
                                    <div className="text-text-muted">Loading projects...</div>
                                </div>
                            ) : sortedProjects.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <p className="text-sm text-text-muted">
                                        {searchQuery.trim() || activeFilter !== 'all'
                                            ? 'No recordings match your search.'
                                            : <>Use the <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">Recordio extension</a> to start a new project.</>
                                        }
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
                                            }}
                                            onOpen={() => handleOpen(item)}
                                            selectMode={selectMode}
                                            selected={selectedIds.has(item.id)}
                                            onSelect={() => toggleSelect(item.id)}
                                            onRename={handleRename}
                                            onDelete={handleDelete}
                                            showUpdatedAt={sortOrder === 'last_updated'}
                                        />
                                    ))}
                                </div>
                            )}
                        </main>
                    </>
                ) : (
                    /* Trash View */
                    <main className="flex-1 overflow-y-auto p-6">
                        <div className="mb-6">
                            <h1 className="heading-2">Trash</h1>
                            <p className="text-sm text-text-muted mt-1">
                                Projects in trash are permanently deleted after 30 days.
                            </p>
                        </div>
                        {loading ? (
                            <div className="flex items-center justify-center h-64">
                                <div className="text-text-muted">Loading...</div>
                            </div>
                        ) : trashProjects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                                <LuTrash2 className="w-10 h-10 text-text-muted/50" />
                                <p className="text-sm text-text-muted">Trash is empty</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                                {trashProjects.map(item => (
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
                        )}
                    </main>
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
                            size="sm"
                            onClick={() => {
                                const allIds = tabFiltered.map(p => p.id);
                                if (selectedIds.size === allIds.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(allIds));
                                }
                            }}
                        >
                            {selectedIds.size === tabFiltered.length ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setShowBulkDeleteModal(true)}
                            disabled={isBulkDeleting}
                        >
                            Delete
                        </Button>
                        <Button
                            size="sm"
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
