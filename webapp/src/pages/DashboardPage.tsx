import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProjectStorage } from '../storage/projectStorage';
import type { Project } from '../types';
import { ProjectCard } from '../components/ProjectCard';
import { SharedVideoCard } from '../components/SharedVideoCard';
import { LogoLink, XButton, Modal, Button, ProBadge, ThemeToggle } from '@shared/components';
import { Dropdown } from '@shared/components/Dropdown';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { BiSupport } from 'react-icons/bi';

import { useUserStore } from '../editor/stores/useUserStore';

import { SupportModal } from '../components/SupportModal';
import { UserMenu } from '../components/UserMenu';
import { AuthModal } from '../editor/components/header/AuthModal';
import { UpgradeModal } from '../editor/components/header/UpgradeModal';
import { ShareService, type SharedVideo, type VideoAnalytics, MAX_SHARED_VIDEOS } from '../editor/services/ShareService';
import { useToast } from '../editor/components/Toast';
import { useAuthListener } from '../hooks/useAuthListener';
import * as Sentry from '@sentry/react';
import { trackProjectOpened } from '../core/analytics';
import { importProjectFromZip } from '../storage/projectTransfer';

type TabId = 'projects' | 'published';
type SortOrder = 'newest' | 'oldest' | 'name';

const SORT_OPTIONS = [
    { value: 'newest' as SortOrder, label: 'Newest first' },
    { value: 'oldest' as SortOrder, label: 'Oldest first' },
    { value: 'name' as SortOrder, label: 'Name A–Z' },
];

export function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [sharedVideos, setSharedVideos] = useState<SharedVideo[]>([]);
    const [analytics, setAnalytics] = useState<Record<string, VideoAnalytics>>({});
    const [loading, setLoading] = useState(true);

    const { userId, hasProAccess } = useUserStore();

    const isAuthenticated = !!userId;
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const { addToast } = useToast();
    const [storageUsed, setStorageUsed] = useState<number | null>(null);
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);
    useAuthListener();
    const importInputRef = useRef<HTMLInputElement>(null);
    const [isImporting, setIsImporting] = useState(false);

    // Tab, sort, and select state
    const [activeTab, setActiveTab] = useState<TabId>('projects');
    const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const selectMode = selectedIds.size > 0;
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    const handleImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsImporting(true);
        try {
            const projectId = await importProjectFromZip(file);
            addToast({ type: 'success', title: 'Project Imported', message: 'Opening project...' });
            window.location.href = `/editor?projectId=${projectId}`;
        } catch (err: any) {
            console.error('Import failed:', err);
            addToast({ type: 'error', title: 'Import Failed', message: err?.message || 'Invalid archive' });
        } finally {
            setIsImporting(false);
            if (importInputRef.current) importInputRef.current.value = '';
        }
    };

    const [checkoutInterval, setCheckoutInterval] = useState<'monthly' | 'yearly' | 'lifetime' | undefined>();

    useEffect(() => {
        // Check for error message in URL
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            addToast({ type: 'error', title: error });
        }

        // Check for checkout intent from marketing site (e.g. ?checkout=yearly)
        const checkout = params.get('checkout');
        if (checkout === 'monthly' || checkout === 'yearly' || checkout === 'lifetime') {
            setCheckoutInterval(checkout);
            setIsUpgradeModalOpen(true);
        }

        // Check for subscription success redirect from Stripe
        if (params.has('subscription-success')) {
            setShowSubscriptionSuccess(true);
        }

        // Clean up only our params — preserve hash fragment for Supabase auth token processing
        if (error || checkout || params.has('subscription-success')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('checkout');
            url.searchParams.delete('error');
            url.searchParams.delete('subscription-success');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }

        loadProjects();
        ProjectStorage.estimateIndexedDBUsage().then(setStorageUsed).catch(console.error);
    }, []);

    // Load shared videos + analytics (reactive to auth state)
    useEffect(() => {
        if (!isAuthenticated) {
            setSharedVideos([]);
            setAnalytics({});
            return;
        }
        ShareService.getSharedVideos().then(videos => {
            setSharedVideos(videos);
            if (videos.length > 0) {
                const uids = videos.map(v => v.cf_video_uid);
                ShareService.getVideoAnalytics(uids).then(setAnalytics);
            }
        });
    }, [isAuthenticated]);

    const loadProjects = async () => {
        try {
            const allProjects = await ProjectStorage.listProjects();
            allProjects.sort((a: Project, b: Project) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            setProjects(allProjects);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    };

    // Sort projects
    const sortedProjects = useMemo(() => {
        const sorted = [...projects];
        switch (sortOrder) {
            case 'newest':
                sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                break;
            case 'oldest':
                sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }
        return sorted;
    }, [projects, sortOrder]);

    // Sort shared videos
    const sortedSharedVideos = useMemo(() => {
        const sorted = [...sharedVideos];
        switch (sortOrder) {
            case 'newest':
                sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                break;
            case 'oldest':
                sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                break;
            case 'name':
                sorted.sort((a, b) => a.project_name.localeCompare(b.project_name));
                break;
        }
        return sorted;
    }, [sharedVideos, sortOrder]);

    // Derive set of project IDs that have shared links (no extra API calls)
    const sharedProjectIds = useMemo(() => {
        return new Set(sharedVideos.map(v => v.project_id));
    }, [sharedVideos]);

    const handleOpen = (projectId: string) => {
        trackProjectOpened();
        window.location.href = `/editor?projectId=${projectId}`;
    };

    const handleRename = useCallback(async (projectId: string, newName: string) => {
        try {
            await ProjectStorage.renameProject(projectId, newName);
            setProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, name: newName, updatedAt: new Date() } : p
            ));
        } catch (error) {
            console.error('Failed to rename project:', error);
        }
    }, []);

    // Bulk delete
    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        const count = selectedIds.size;
        try {
            for (const id of selectedIds) {
                await ProjectStorage.deleteProject(id);
            }
            setProjects(prev => prev.filter(p => !selectedIds.has(p.id)));
            setSelectedIds(new Set());
            setShowBulkDeleteModal(false);
            addToast({ type: 'success', title: 'Projects Deleted', message: `${count} project${count !== 1 ? 's' : ''} deleted` });
        } catch (error) {
            console.error('Failed to delete projects:', error);
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const toggleSelect = (projectId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    };

    const exitSelectMode = () => {
        setSelectedIds(new Set());
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const handleUnshare = async (video: SharedVideo) => {
        // Optimistic removal — remove from UI immediately
        setSharedVideos(prev => prev.filter(v => v.id !== video.id));

        try {
            await ShareService.deleteSharedVideo(video.id);
            addToast({ type: 'success', title: 'Video Unshared', message: `"${video.project_name}" is no longer shared` });
        } catch (e: any) {
            console.error('[Dashboard] Unshare failed:', e);
            Sentry.captureException(e, { extra: { shareId: video.id, phase: 'unshare' } });
            // Restore the card on failure
            setSharedVideos(prev => [...prev, video]);
            addToast({ type: 'error', title: 'Unshare Failed', message: e?.message || 'Something went wrong' });
        }
    };

    const handleBulkDelist = async () => {
        const videosToRemove = sharedVideos.filter(v => selectedIds.has(v.id));
        const count = videosToRemove.length;
        setIsBulkDeleting(true);
        try {
            for (const video of videosToRemove) {
                await handleUnshare(video);
            }
            setSelectedIds(new Set());
            addToast({ type: 'success', title: 'Videos Delisted', message: `${count} video${count !== 1 ? 's' : ''} delisted` });
        } catch (error) {
            console.error('Failed to delist videos:', error);
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const handleTabChange = (tab: TabId) => {
        setActiveTab(tab);
        // Exit select mode when switching tabs
        exitSelectMode();
    };

    return (
        <div className="min-h-screen bg-surface-body text-text-main">
            {/* Header */}
            <header className="border-b border-border bg-surface">
                <div style={{ maxWidth: 1400 }} className="mx-auto px-6 py-4 flex items-center">
                    <LogoLink />
                    {hasProAccess() && (
                        <ProBadge className="ml-1" />
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <button onClick={() => setIsSupportModalOpen(true)} title="Contact Support" className="interactive-icon">
                                <BiSupport size={18} />
                            </button>
                            <ThemeToggle />
                        </div>
                        {isAuthenticated ? (
                            <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                        ) : (
                            <Button variant="ghost" onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                                Sign In
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <div style={{ maxWidth: 1400 }} className="mx-auto">


                {/* Tab Bar */}
                <div className="mx-6 mt-4 px-6 flex items-center gap-6 border border-border rounded-xl bg-surface">
                    <TabButton
                        active={activeTab === 'projects'}
                        count={projects.length}
                        onClick={() => handleTabChange('projects')}
                    >
                        Projects
                    </TabButton>
                    <TabButton
                        active={activeTab === 'published'}
                        count={sharedVideos.length}
                        onClick={() => handleTabChange('published')}
                    >
                        Published
                    </TabButton>
                    <div className="flex-1" />
                    {activeTab === 'projects' && projects.length > 0 && storageUsed != null && (
                        <span className="text-xs text-text-muted">
                            <span className="text-text-main">{formatBytes(storageUsed)}</span> local storage used
                        </span>
                    )}
                    {activeTab === 'published' && isAuthenticated && sharedVideos.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-text-muted">
                                {sharedVideos.length} of {MAX_SHARED_VIDEOS}
                            </span>
                            <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary rounded-full transition-all duration-300"
                                    style={{ width: `${(sharedVideos.length / MAX_SHARED_VIDEOS) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}
                    <div className={`my-2 ${((activeTab === 'projects' && projects.length > 1) || (activeTab === 'published' && sharedVideos.length > 1)) ? 'visible' : 'invisible'}`}>
                        <Dropdown
                            options={SORT_OPTIONS}
                            value={sortOrder}
                            onChange={setSortOrder}
                            fullWidth={false}
                            buttonClassName="h-8 text-xs"
                        />
                    </div>
                </div>

                {/* Projects Tab */}
                {activeTab === 'projects' && (
                    <main className="p-6">
                        {/* Toolbar */}
                        <div className="flex items-center gap-3 mb-4">
                            {import.meta.env.DEV && (
                                <>
                                    <input
                                        ref={importInputRef}
                                        type="file"
                                        accept=".zip"
                                        className="hidden"
                                        onChange={handleImportProject}
                                    />
                                    <button
                                        onClick={() => importInputRef.current?.click()}
                                        disabled={isImporting}
                                        className="text-xs text-primary hover:text-primary-highlighted transition-colors disabled:opacity-50"
                                    >
                                        {isImporting ? 'Importing...' : '📦 Import Project'}
                                    </button>
                                </>
                            )}

                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center h-64">
                                <div className="text-text-muted">Loading projects...</div>
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                                <p className="text-sm text-text-muted">
                                    Use the <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">Recordio extension</a> to start a new project.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {sortedProjects.map(project => (
                                    <ProjectCard
                                        key={project.id}
                                        project={project}
                                        onOpen={() => handleOpen(project.id)}
                                        selectMode={selectMode}
                                        selected={selectedIds.has(project.id)}
                                        onSelect={() => toggleSelect(project.id)}
                                        isShared={sharedProjectIds.has(project.id)}
                                        onRename={(newName) => handleRename(project.id, newName)}
                                    />
                                ))}
                            </div>
                        )}
                    </main>
                )}

                {/* Published Tab */}
                {activeTab === 'published' && (
                    <section className="p-6">
                        {isAuthenticated && sharedVideos.length > 0 && sharedVideos.length >= MAX_SHARED_VIDEOS && (
                            <div className="flex items-center gap-3 mb-4">
                                <span className="text-xs text-text-muted">
                                    Limit reached — contact <a href="mailto:support@recordio.cc" className="underline text-primary hover:text-primary-highlighted">support@recordio.cc</a> to request an increase
                                </span>
                            </div>
                        )}
                        {!isAuthenticated ? (
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                                <p className="text-sm text-text-muted">Sign in to see your published videos</p>
                                <Button size="sm" onClick={() => setIsAuthModalOpen(true)}>Sign in</Button>
                            </div>
                        ) : sharedVideos.length === 0 ? (
                            <p className="text-sm text-text-muted">You have no published videos</p>
                        ) : (() => {
                            const localProjectIds = new Set(projects.map(p => p.id));
                            return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {sortedSharedVideos.map(video => (
                                        <SharedVideoCard
                                            key={video.id}
                                            video={video}
                                            localProjectExists={localProjectIds.has(video.project_id)}
                                            analytics={analytics[video.cf_video_uid]}
                                            selectMode={selectMode}
                                            selected={selectedIds.has(video.id)}
                                            onSelect={() => toggleSelect(video.id)}
                                        />
                                    ))}
                                </div>
                            );
                        })()}
                    </section>
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
                                const allIds = activeTab === 'projects'
                                    ? projects.map(p => p.id)
                                    : sharedVideos.map(v => v.id);
                                if (selectedIds.size === allIds.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(allIds));
                                }
                            }}
                        >
                            {selectedIds.size === (activeTab === 'projects' ? projects.length : sharedVideos.length)
                                ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                if (activeTab === 'projects') {
                                    setShowBulkDeleteModal(true);
                                } else {
                                    handleBulkDelist();
                                }
                            }}
                            disabled={isBulkDeleting}
                        >
                            {activeTab === 'projects' ? 'Delete' : 'Delist'}
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
                    // Preserve checkout intent in URL so it survives OAuth redirect
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
        </div>
    );
}

/** Tab button with active underline and count badge */
function TabButton({ active, count, onClick, children }: {
    active: boolean;
    count: number;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`
                py-3 text-sm font-medium transition-colors relative cursor-pointer self-stretch flex items-center
                ${active
                    ? 'text-text-highlighted'
                    : 'text-text-muted hover:text-text-main'
                }
            `}
        >
            <span>{children}</span>
            <span className={`
                ml-1.5 text-xs px-1.5 py-0.5 rounded-full
                ${active
                    ? 'bg-primary/20 text-primary'
                    : 'bg-state-inactive text-text-muted'
                }
            `}>
                {count}
            </span>
            {/* Active underline — sits on the border */}
            {active && (
                <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
        </button>
    );
}
