import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SyncService, type ProjectListItem } from '../storage/syncService';
import { ProjectCard } from '../components/ProjectCard';
import { LogoLink, XButton, Modal, Button, ProBadge, ThemeToggle } from '@shared/components';
import { Dropdown } from '@shared/components/Dropdown';
import { BRIDGE_MSG, CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { MdOutlineBugReport, MdFiberManualRecord } from 'react-icons/md';
import { FcGoogle } from 'react-icons/fc';

import { useUserStore } from '../editor/stores/useUserStore';
import { AuthManager } from '../auth/AuthManager';

import { SupportModal } from '../components/SupportModal';
import { UserMenu } from '../components/UserMenu';
import { AuthModal } from '../editor/components/header/AuthModal';
import { UpgradeModal } from '../editor/components/header/UpgradeModal';
import { useToast } from '../editor/components/Toast';
import { useAuthListener } from '../hooks/useAuthListener';
import { trackProjectOpened } from '../core/analytics';
import { importProjectFromZip } from '../storage/projectTransfer';
import { navigate } from '../navigate';
import { cleanupStorageIfNeeded } from '../storage/storageCleanup';

const EXTENSION_ID = import.meta.env.DEV
    ? 'lpponocoanighhephabalkejmdbjlhmi'
    : 'bbcdpipjplklaneplfmlhhibnllhinii';

type SortOrder = 'newest' | 'oldest' | 'name';

const SORT_OPTIONS = [
    { value: 'newest' as SortOrder, label: 'Newest first' },
    { value: 'oldest' as SortOrder, label: 'Oldest first' },
    { value: 'name' as SortOrder, label: 'Name A\u2013Z' },
];

export function DashboardPage() {
    const [projects, setProjects] = useState<ProjectListItem[]>([]);
    const [loading, setLoading] = useState(true);

    const { userId, hasProAccess } = useUserStore();

    const isAuthenticated = !!userId;
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const { addToast } = useToast();
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);
    useAuthListener();
    const importInputRef = useRef<HTMLInputElement>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    // Sort and select state
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
            navigate(`/editor?projectId=${projectId}`);
        } catch (err: any) {
            console.error('Import failed:', err);
            addToast({ type: 'error', title: 'Import Failed', message: err?.message || 'Invalid archive' });
        } finally {
            setIsImporting(false);
            if (importInputRef.current) importInputRef.current.value = '';
        }
    };

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
        cleanupStorageIfNeeded();
        SyncService.resumePendingUploads().catch(console.error);

    }, []);

    // Reload projects when auth state changes (login/logout)
    useEffect(() => {
        loadProjects();
    }, [isAuthenticated]);

    const loadProjects = async () => {
        try {
            const allProjects = await SyncService.listProjects(userId, (projectId, thumbnailUrl) => {
                setProjects(prev => prev.map(p =>
                    p.id === projectId ? { ...p, thumbnail: thumbnailUrl } : p
                ));
            });
            setProjects(allProjects);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    };

    // All projects from listProjects are usable: cloud projects are filtered
    // for ready status, and local projects always have blobs.
    const visibleProjects = projects;

    // Sort projects
    const sortedProjects = useMemo(() => {
        const sorted = [...visibleProjects];
        switch (sortOrder) {
            case 'newest':
                sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                break;
            case 'oldest':
                sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                break;
            case 'name':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }
        return sorted;
    }, [visibleProjects, sortOrder]);

    const handleOpen = (item: ProjectListItem) => {
        trackProjectOpened();
        navigate(`/editor?projectId=${item.id}`);
    };

    // Bulk delete
    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        const count = selectedIds.size;
        try {
            for (const id of selectedIds) {
                await SyncService.deleteProject(id);
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

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const exitSelectMode = () => {
        setSelectedIds(new Set());
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
                            <Button variant="icon" icon={MdOutlineBugReport} onClick={() => setIsSupportModalOpen(true)} title="Report a Bug" />
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

                {/* Toolbar Bar */}
                <div className="mx-6 mt-4 px-6 flex items-center gap-6 border border-border rounded-xl bg-surface">
                    <div className="py-3 text-sm font-medium text-text-highlighted relative self-stretch flex items-center">
                        <span>Projects</span>
                        <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                            {visibleProjects.length}
                        </span>
                        <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary rounded-full" />
                    </div>
                    <div className="flex-1" />
                    <Button variant="primary" size="sm" icon={MdFiberManualRecord} onClick={handleRecord}>
                        Record
                    </Button>
                    <div className={`my-2 ${visibleProjects.length > 1 ? 'visible' : 'invisible'}`}>
                        <Dropdown
                            options={SORT_OPTIONS}
                            value={sortOrder}
                            onChange={setSortOrder}
                            fullWidth={false}
                            buttonClassName="h-8 text-xs"
                        />
                    </div>
                </div>

                {/* Projects Grid */}
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
                                    {isImporting ? 'Importing...' : 'Import Project'}
                                </button>
                            </>
                        )}
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="text-text-muted">Loading projects...</div>
                        </div>
                    ) : visibleProjects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <p className="text-sm text-text-muted">
                                Use the <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">Recordio extension</a> to start a new project.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {sortedProjects.map(item => (
                                <ProjectCard
                                    key={item.id}
                                    project={{
                                        id: item.id,
                                        name: item.name,
                                        thumbnail: item.thumbnail,
                                        createdAt: item.createdAt,
                                        durationMs: item.durationMs,
                                    }}
                                    onOpen={() => handleOpen(item)}
                                    selectMode={selectMode}
                                    selected={selectedIds.has(item.id)}
                                    onSelect={() => toggleSelect(item.id)}
                                    isShared={!!item.cfVideoUid}
                                />
                            ))}
                        </div>
                    )}
                </main>
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
                                const allIds = visibleProjects.map(p => p.id);
                                if (selectedIds.size === allIds.length) {
                                    setSelectedIds(new Set());
                                } else {
                                    setSelectedIds(new Set(allIds));
                                }
                            }}
                        >
                            {selectedIds.size === visibleProjects.length ? 'Deselect All' : 'Select All'}
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

            {/* Mandatory login modal — non-dismissable when not authenticated */}
            <Modal isOpen={!isAuthenticated} maxWidth="max-w-[400px]">
                <h2 className="text-lg font-semibold text-text-highlighted mb-2">
                    Sign In to Recordio
                </h2>
                <p className="text-sm text-text-main mb-6">
                    Sign in to manage your projects.
                </p>

                {loginError && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-sm text-xs mb-4">
                        {loginError}
                    </div>
                )}

                <button
                    type="button"
                    onClick={async () => {
                        setLoginLoading(true);
                        setLoginError(null);
                        const result = await AuthManager.signInWithProvider('google');
                        if (result.error) {
                            setLoginError(result.error.message);
                            setLoginLoading(false);
                        }
                    }}
                    disabled={loginLoading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted font-medium rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50"
                >
                    {loginLoading ? (
                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                    ) : (
                        <FcGoogle className="icon-lg" />
                    )}
                    <span>{loginLoading ? 'Connecting...' : 'Continue with Google'}</span>
                </button>
            </Modal>
        </div>
    );
}
