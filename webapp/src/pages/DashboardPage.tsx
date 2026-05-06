import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { LuTrash2 } from 'react-icons/lu';
import { CloudProjectService, type ProjectListItem } from '../storage/cloudProjectService';
import type { CloudFolder } from '../storage/cloudStorage';
import { ProjectCard } from '../components/ProjectCard';
import { DashboardSidebar, type DashboardView } from '../components/DashboardSidebar';
import { DashboardHeader, type FilterTab, type SortOrder } from '../components/DashboardHeader';
import { XButton, Modal, Button } from '@shared/components';
import { BRIDGE_MSG, CHROME_EXTENSION_URL } from '@shared/types/bridge';

import { useUserStore } from '../editor/stores/useUserStore';
import { AuthManager } from '../auth/AuthManager';

import { SupportModal } from '../components/SupportModal';
import { AuthModal } from '../editor/components/header/AuthModal';
import { UpgradeModal } from '../editor/components/header/UpgradeModal';
import { useToast } from '../editor/components/Toast';
import { trackProjectOpened } from '../core/analytics';

import { navigate } from '../navigate';

const EXTENSION_ID = import.meta.env.DEV
    ? 'lpponocoanighhephabalkejmdbjlhmi'
    : 'bbcdpipjplklaneplfmlhhibnllhinii';

export function DashboardPage() {
    const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);
    const [folders, setFolders] = useState<CloudFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeView, setActiveView] = useState<DashboardView>('all');

    const { userId, hasProAccess } = useUserStore();

    // Split into active and trashed
    const projects = useMemo(() => allProjects.filter(p => !p.deletedAt), [allProjects]);
    const trashProjects = useMemo(() => allProjects.filter(p => !!p.deletedAt), [allProjects]);

    const isAuthenticated = !!userId;
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const { addToast } = useToast();
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);

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

    const [checkoutInterval, setCheckoutInterval] = useState<'monthly' | 'yearly' | undefined>();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            addToast({ type: 'error', title: error });
        }

        const checkout = params.get('checkout');
        if (checkout === 'monthly' || checkout === 'yearly') {
            setCheckoutInterval(checkout);
            setIsUpgradeModalOpen(true);
        }

        if (params.has('subscription-success')) {
            setShowSubscriptionSuccess(true);
        }

        if (error || checkout || params.has('subscription-success')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('checkout');
            url.searchParams.delete('error');
            url.searchParams.delete('subscription-success');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
    }, []);

    // Load projects once auth is ready
    useEffect(() => {
        if (!isAuthenticated) return;

        const ctrl = { cancelled: false };
        console.log('[Dashboard] effect fired, isAuthenticated=', isAuthenticated);
        (async () => {
            try {
                await AuthManager.ready;
                console.log('[Dashboard] ready resolved, cancelled=', ctrl.cancelled);
                if (ctrl.cancelled) return;
                const [loaded, loadedFolders] = await Promise.all([
                    CloudProjectService.listProjects(),
                    CloudProjectService.listFolders(),
                ]);
                if (!ctrl.cancelled) {
                    setAllProjects(loaded);
                    setFolders(loadedFolders);
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
                if (!ctrl.cancelled) console.error('Failed to load projects:', error);
            } finally {
                if (!ctrl.cancelled) setLoading(false);
            }
        })();

        return () => { ctrl.cancelled = true; };
    }, [isAuthenticated]);

    // View-filtered base list
    const viewProjects = useMemo(() => {
        if (activeView === 'starred') {
            return projects.filter(p => p.isStarred);
        }
        if (activeView === 'published') {
            return projects.filter(p => p.shareSlug);
        }
        if (typeof activeView === 'object') {
            return projects.filter(p => p.folderId === activeView.folder);
        }
        return projects;
    }, [projects, activeView]);

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
            ? projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : projects;
        return base.filter(p => (p.durationMs ?? 0) < 60000).length;
    }, [projects, searchQuery]);

    const sharedCount = useMemo(() => projects.filter(p => p.isShared).length, [projects]);
    const starredCount = useMemo(() => projects.filter(p => p.isStarred).length, [projects]);

    // Active folder name for header
    const activeFolderName = useMemo(() => {
        if (typeof activeView === 'object') {
            return folders.find(f => f.id === activeView.folder)?.name ?? 'Folder';
        }
        return null;
    }, [activeView, folders]);

    const handleCreateFolder = async (name: string, description: string) => {
        try {
            const folder = await CloudProjectService.createFolder(name, description);
            setFolders(prev => [...prev, folder]);
            addToast({ type: 'success', title: `Folder "${name}" created` });
        } catch (err) {
            console.error('Failed to create folder:', err);
            addToast({ type: 'error', title: 'Failed to create folder' });
        }
    };

    const handleEditFolder = async (folderId: string, name: string, description: string) => {
        try {
            const updated = await CloudProjectService.updateFolder(folderId, name, description);
            if (updated) {
                setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: updated.name, description: updated.description, updated_at: updated.updated_at } : f));
                addToast({ type: 'success', title: `Folder updated` });
            }
        } catch (err) {
            console.error('Failed to update folder:', err);
            addToast({ type: 'error', title: 'Failed to update folder' });
        }
    };

    const handleDeleteFolder = async (folderId: string) => {
        const folder = folders.find(f => f.id === folderId);
        try {
            await CloudProjectService.deleteFolder(folderId);
            setFolders(prev => prev.filter(f => f.id !== folderId));
            // Unassign projects locally
            setAllProjects(prev => prev.map(p =>
                p.folderId === folderId ? { ...p, folderId: null } : p
            ));
            // If we were viewing this folder, go back to all
            if (typeof activeView === 'object' && activeView.folder === folderId) {
                setActiveView('all');
            }
            addToast({ type: 'success', title: `Folder "${folder?.name}" deleted` });
        } catch (err) {
            console.error('Failed to delete folder:', err);
            addToast({ type: 'error', title: 'Failed to delete folder' });
        }
    };

    const handleOpen = (item: ProjectListItem) => {
        trackProjectOpened();
        navigate(`/editor?projectId=${item.id}`);
    };

    // Restore from trash
    const handleRestore = async (projectId: string) => {
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
            console.error('Failed to rename project:', err);
            addToast({ type: 'error', title: 'Failed to rename project' });
        }
    };

    // Star/unstar project
    const handleStar = async (projectId: string, starred: boolean) => {
        try {
            await CloudProjectService.starProject(projectId, starred);
            setAllProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, isStarred: starred } : p
            ));
        } catch (err) {
            console.error('Failed to star project:', err);
            addToast({ type: 'error', title: 'Failed to update star' });
        }
    };

    // Move project to folder
    const handleMoveToFolder = async (projectId: string, folderId: string | null) => {
        try {
            await CloudProjectService.moveProjectToFolder(projectId, folderId);
            setAllProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, folderId } : p
            ));
            const folderName = folderId ? folders.find(f => f.id === folderId)?.name : null;
            addToast({ type: 'success', title: folderId ? `Moved to "${folderName}"` : 'Removed from folder' });
        } catch (err) {
            console.error('Failed to move project:', err);
            addToast({ type: 'error', title: 'Failed to move project' });
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
        } catch (err) {
            console.error('Failed to delete project:', err);
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
        } catch (error) {
            console.error('Failed to delete projects:', error);
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

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex">
            {/* Sidebar */}
            <DashboardSidebar
                activeView={activeView}
                onViewChange={setActiveView}
                projectCount={projects.length}
                hasProAccess={hasProAccess()}
                starredCount={starredCount}
                trashCount={trashProjects.length}
                publishedCount={sharedCount}
                folders={folders}
                onCreateFolder={handleCreateFolder}
                onEditFolder={handleEditFolder}
                onDeleteFolder={handleDeleteFolder}
                onRecord={handleRecord}
                isAuthenticated={isAuthenticated}
                onOpenSupport={() => setIsSupportModalOpen(true)}
                onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)}
                onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />

            {/* Main Content */}
            <div className="flex-1 min-w-0 flex flex-col">
                {activeView !== 'trash' ? (
                    <>
                        {activeFolderName && (
                            <div className="px-6 pt-4">
                                <h1 className="text-lg font-semibold text-text-highlighted">{activeFolderName}</h1>
                            </div>
                        )}
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
                                            : activeView === 'starred'
                                                ? 'No starred projects yet. Star a project from its menu to see it here.'
                                                : activeFolderName
                                                    ? 'This folder is empty.'
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
                                                expiresAt: item.expiresAt,
                                                shareSlug: item.shareSlug,
                                                isStarred: item.isStarred,
                                                folderId: item.folderId,
                                            }}
                                            onOpen={() => handleOpen(item)}
                                            selectMode={selectMode}
                                            selected={selectedIds.has(item.id)}
                                            onSelect={() => toggleSelect(item.id)}
                                            onRename={handleRename}
                                            onStar={handleStar}
                                            onMoveToFolder={handleMoveToFolder}
                                            onDelete={handleDelete}
                                            folders={folders}
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
                            <h1 className="text-lg font-semibold text-text-highlighted">Trash</h1>
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
                                        onRestore={() => hasProAccess() ? handleRestore(item.id) : setIsUpgradeModalOpen(true)}
                                    />
                                ))}
                            </div>
                        )}
                    </main>
                )}
            </div>

            {/* Floating Action Bar — Select Mode */}
            {selectMode && createPortal(
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-index-overlay)] animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <div className="flex items-center gap-3 bg-surface-raised border border-border rounded-xl px-5 py-3 shadow-float">
                        <span className="text-sm text-text-highlighted font-medium">
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

            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => { setIsUpgradeModalOpen(false); setCheckoutInterval(undefined); }}
                onSignInRequest={() => {
                    const interval = checkoutInterval || 'yearly';
                    window.history.replaceState({}, '', `/?checkout=${interval}`);
                    setIsUpgradeModalOpen(false);
                    setIsAuthModalOpen(true);
                }}
                initialInterval={checkoutInterval}
                autoCheckout={!!checkoutInterval && isAuthenticated}
            />

            {/* Bulk Delete Confirmation Modal */}
            {showBulkDeleteModal && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[var(--z-index-modal)] backdrop-blur-sm p-4">
                    <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-highlighted">Delete Projects</h2>
                            <XButton
                                onClick={() => setShowBulkDeleteModal(false)}
                                title="Close"
                            />
                        </div>

                        <p className="text-sm text-text-main mb-6">
                            Are you sure you want to delete <span className="text-text-highlighted font-medium">{selectedIds.size}</span> project{selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
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
                <h2 className="text-lg font-semibold text-text-highlighted mb-2">Welcome to Pro!</h2>
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

            {/* Mandatory login modal — non-dismissable when not authenticated */}
            <AuthModal isOpen={!isAuthenticated} onClose={() => {}} />
        </div>
    );
}
