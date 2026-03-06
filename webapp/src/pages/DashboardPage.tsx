import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ProjectStorage } from '../storage/projectStorage';
import type { Project } from '../types';
import { ProjectCard } from '../components/ProjectCard';
import { SharedVideoCard } from '../components/SharedVideoCard';
import { LogoLink, XButton, Modal } from '@shared/components';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { BiSupport } from 'react-icons/bi';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { useUserStore } from '../editor/stores/useUserStore';
import { useThemeStore } from '../stores/useThemeStore';
import { SupportModal } from '../components/SupportModal';
import { UserMenu } from '../components/UserMenu';
import { AuthModal } from '../editor/components/header/AuthModal';
import { UpgradeModal } from '../editor/components/header/UpgradeModal';
import { ShareService, type SharedVideo, type VideoAnalytics, MAX_SHARED_VIDEOS } from '../editor/services/ShareService';
import { useToast } from '../editor/components/Toast';
import { useAuthListener } from '../hooks/useAuthListener';
import * as Sentry from '@sentry/react';
import { trackProjectOpened } from '../core/analytics';

export function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [sharedVideos, setSharedVideos] = useState<SharedVideo[]>([]);
    const [analytics, setAnalytics] = useState<Record<string, VideoAnalytics>>({});
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { userId, hasProAccess } = useUserStore();
    const { theme, setTheme } = useThemeStore();
    const isAuthenticated = !!userId;
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const { addToast } = useToast();
    const [storageUsed, setStorageUsed] = useState<number | null>(null);
    const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showSubscriptionSuccess, setShowSubscriptionSuccess] = useState(false);
    useAuthListener();

    const [checkoutInterval, setCheckoutInterval] = useState<'monthly' | 'yearly' | 'lifetime' | undefined>();

    useEffect(() => {
        // Check for error message in URL
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            setErrorMessage(error);
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

    const handleOpen = (projectId: string) => {
        trackProjectOpened();
        window.location.href = `/editor?projectId=${projectId}`;
    };

    const handleDelete = async (projectId: string) => {
        try {
            await ProjectStorage.deleteProject(projectId);
            setProjects(prev => prev.filter(p => p.id !== projectId));
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };

    const handleDeleteAll = async () => {
        setIsDeleting(true);
        try {
            for (const project of projects) {
                await ProjectStorage.deleteProject(project.id);
            }
            setProjects([]);
            setShowDeleteAllModal(false);
            addToast({ type: 'success', title: 'All Projects Deleted', message: `${projects.length} project${projects.length !== 1 ? 's' : ''} deleted` });
        } catch (error) {
            console.error('Failed to delete projects:', error);
        } finally {
            setIsDeleting(false);
        }
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

    return (
        <div className="min-h-screen bg-surface-body text-text-main">
            {/* Header */}
            <header className="border-b border-border">
                <div style={{ maxWidth: 1400 }} className="mx-auto px-6 py-4 flex items-center">
                    <LogoLink />
                    {hasProAccess() && (
                        <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase ml-1">Pro</span>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <button onClick={() => setIsSupportModalOpen(true)} title="Contact Support" className="interactive-icon">
                                <BiSupport size={18} />
                            </button>
                            <button
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                                className="interactive-icon"
                            >
                                {theme === 'dark' ? <MdLightMode size={18} /> : <MdDarkMode size={18} />}
                            </button>
                        </div>
                        {isAuthenticated ? (
                            <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                        ) : (
                            <button onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features" className="interactive-ghost flex items-center justify-center gap-2">
                                Sign In
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div style={{ maxWidth: 1400 }} className="mx-auto">
                {/* Error Message */}
                {errorMessage && (
                    <div className="mt-4 w-fit mx-auto bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg flex items-center gap-3">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{errorMessage}</span>
                        <button
                            onClick={() => setErrorMessage(null)}
                            className="ml-auto text-red-400 hover:text-red-300"
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Published Videos Section */}
                <section className="p-6 pb-2">
                    <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-lg font-medium text-text-highlighted">Published Videos</h2>
                        {isAuthenticated && sharedVideos.length > 0 && (
                            <>
                                <span className="text-xs text-text-muted">
                                    {sharedVideos.length} of {MAX_SHARED_VIDEOS}
                                </span>
                                <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary rounded-full transition-all duration-300"
                                        style={{ width: `${(sharedVideos.length / MAX_SHARED_VIDEOS) * 100}%` }}
                                    />
                                </div>
                            </>
                        )}
                        {isAuthenticated && sharedVideos.length >= MAX_SHARED_VIDEOS && (
                            <span className="text-xs text-text-muted">
                                Limit reached — contact <a href="mailto:support@recordio.cc" className="underline text-primary hover:text-primary-highlighted">support@recordio.cc</a> to request an increase
                            </span>
                        )}
                    </div>
                    {!isAuthenticated ? (
                        <p className="text-sm text-text-muted">Log in to see published videos</p>
                    ) : sharedVideos.length === 0 ? (
                        <p className="text-sm text-text-muted">You have no published videos</p>
                    ) : (() => {
                        const localProjectIds = new Set(projects.map(p => p.id));
                        return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {sharedVideos.map(video => (
                                    <SharedVideoCard
                                        key={video.id}
                                        video={video}
                                        localProjectExists={localProjectIds.has(video.project_id)}
                                        analytics={analytics[video.cf_video_uid]}
                                        onUnshare={handleUnshare}
                                    />
                                ))}
                            </div>
                        );
                    })()}
                </section>

                {/* Projects Section */}
                <main className="p-6">
                    <div className="flex items-baseline gap-2 mb-4">
                        <h2 className="text-lg font-medium text-text-highlighted">Projects</h2>
                        <span className="text-xs text-text-muted">
                            · stored on this device{storageUsed != null ? ` · ${formatBytes(storageUsed)}` : ''}
                        </span>
                        {projects.length > 1 && (
                            <button
                                onClick={() => setShowDeleteAllModal(true)}
                                className="ml-auto text-xs text-text-muted hover:text-destructive transition-colors"
                            >
                                Delete All
                            </button>
                        )}
                    </div>
                    <p className="text-sm text-text-muted mb-4">
                        Use the <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">Recordio extension</a> to start a new project.
                    </p>
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="text-text-muted">Loading projects...</div>
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center max-w-md mx-auto">
                            <div className="text-text-muted text-sm">
                                Projects are stored locally in your browser. If you recorded on a different browser or device, open Recordio there to find your projects.
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {projects.map(project => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    onOpen={() => handleOpen(project.id)}
                                    onDelete={() => handleDelete(project.id)}
                                />
                            ))}
                        </div>
                    )}
                </main>
            </div>
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

            {/* Delete All Confirmation Modal */}
            {showDeleteAllModal && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[var(--z-index-modal)] backdrop-blur-sm p-4">
                    <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-text-highlighted">Delete All Projects</h2>
                            <XButton
                                onClick={() => setShowDeleteAllModal(false)}
                                title="Close"
                            />
                        </div>

                        <p className="text-sm text-text-main mb-6">
                            Are you sure you want to delete <span className="text-text-highlighted font-medium">{projects.length}</span> project{projects.length !== 1 ? 's' : ''}? This action cannot be undone.
                        </p>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowDeleteAllModal(false)}
                                disabled={isDeleting}
                                className="interactive-base flex items-center justify-center gap-2"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteAll}
                                disabled={isDeleting}
                                className="px-3 py-1.5 text-xs text-white bg-destructive hover:bg-destructive/90 rounded-sm shadow-sm transition-colors disabled:opacity-50"
                            >
                                {isDeleting ? 'Deleting...' : 'Delete All'}
                            </button>
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
                <button
                    onClick={() => setShowSubscriptionSuccess(false)}
                    className="interactive-primary w-full"
                >
                    Get Started
                </button>
            </Modal>
        </div>
    );
}
