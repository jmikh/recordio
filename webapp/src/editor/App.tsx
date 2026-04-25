import { useState, useEffect, useRef, useCallback } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { ExportModal } from './components/settings/ExportModal';
import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';
import { TimelineToolbar } from './components/timeline/TimelineToolbar';
import { useUIStore, CanvasMode } from './stores/useUIStore';
import { getTimeMapper } from './hooks/useTimeMapper';


import { ProjectStorage } from '../storage/projectStorage';
import { CloudStorage } from '../storage/cloudStorage';
import { SyncService } from '../storage/syncService';
import { ProgressModal, Modal } from '@shared/components';
import { formatTimeCode } from './utils';
import { DebugBar } from './components/DebugBar';
import { Header } from './components/header/Header';
import { ConflictModal } from './components/ConflictModal';



// Auth imports
import { AuthManager, supabase } from '../auth/AuthManager';
import { useUserStore } from './stores/useUserStore';
import { ShareService } from './services/ShareService';
import { trackEditorLoaded } from '../core/analytics';
import { navigate } from '../navigate';

/** Fetch a remote image once and return it as a data URL to avoid repeated network requests. */
async function cacheAvatarUrl(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

function Editor() {
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();

    const loadProject = useProjectStore(s => s.loadProject);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const showDebugBar = useUIStore(s => s.showDebugBar);
    const canvasMode = useUIStore(s => s.canvasMode);


    // Export state (must be at top level - Rules of Hooks)
    const isExporting = useProjectStore(s => s.exportState.isExporting);
    const exportProgress = useProjectStore(s => s.exportState.progress);
    const timeRemainingSeconds = useProjectStore(s => s.exportState.timeRemainingSeconds);
    const exportPhase = useProjectStore(s => s.exportState.phase);
    const decodeFallback = useProjectStore(s => s.exportState.decodeFallback);


    // Initialization State
    const [isLoading, setIsLoading] = useState(true);
    const [loadingStatus, setLoadingStatus] = useState('Loading project...');
    const [loadError, setLoadError] = useState<string | null>(null);


    // Initialize authentication
    useEffect(() => {
        if (!supabase) {
            return;
        }

        // Check if this is an OAuth callback (tokens in URL hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');

        if (accessToken) {

            // Supabase will automatically process the hash and create a session
            // Clear the hash after processing to clean up the URL
            setTimeout(() => {
                window.location.hash = '';

            }, 1000);
        }

        // Initialize auth state listener
        AuthManager.initAuthListener(async (session) => {
            const { setUser, setSubscription, clearUser } = useUserStore.getState();

            if (session) {
                // User is logged in


                const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                const rawPicture = avatar_url || picture || null;

                // Skip fetch if we already initiated a cache for this source URL.
                // The UI uses initials as a fallback while the data URL loads.
                const cached = useUserStore.getState();
                let userPicture: string | null;
                if (rawPicture && cached.pictureSourceUrl === rawPicture) {
                    userPicture = cached.picture;
                } else {
                    // Set pictureSourceUrl immediately so subsequent rapid
                    // onAuthStateChange callbacks see the match and skip (prevents 429s)
                    setUser(session.user.id, session.user.email || '', userName, null, rawPicture);
                    userPicture = rawPicture ? await cacheAvatarUrl(rawPicture) : null;
                }

                setUser(session.user.id, session.user.email || '', userName, userPicture, rawPicture);

                // Fetch subscription status from database
                try {
                    const { data, error } = await supabase!
                        .from('subscriptions')
                        .select('*')
                        .eq('user_id', session.user.id)
                        .maybeSingle();

                    if (error) {
                        // User is on free plan (no subscription found)
                    } else if (data) {
                        setSubscription({
                            status: data.status,
                            planId: data.plan_id,
                            currentPeriodEnd: new Date(data.current_period_end),
                            cancelAtPeriodEnd: data.cancel_at_period_end,
                            stripeCustomerId: data.stripe_customer_id,
                            billingInterval: data.billing_interval || null
                        });

                    }
                } catch (error) {
                    // Subscription table not configured yet
                }
            } else {
                // User is logged out
                clearUser();
            }
        });

        // Check initial session
        AuthManager.getSession().then(async (session) => {
            if (session) {
                const { setUser } = useUserStore.getState();
                const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                const rawPicture = avatar_url || picture || null;

                // Skip fetch if we already initiated a cache for this source URL.
                const cached = useUserStore.getState();
                let userPicture: string | null;
                if (rawPicture && cached.pictureSourceUrl === rawPicture) {
                    userPicture = cached.picture;
                } else {
                    setUser(session.user.id, session.user.email || '', userName, null, rawPicture);
                    userPicture = rawPicture ? await cacheAvatarUrl(rawPicture) : null;
                }

                setUser(session.user.id, session.user.email || '', userName, userPicture, rawPicture);
            }
        });
    }, []);


    // Load Project ID from URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('projectId');

        async function init() {
            if (!projectId) {
                navigate('/', { replace: true });
                return;
            }
            try {
                const isAuthed = useUserStore.getState().isAuthenticated;
                let loadedProject = await ProjectStorage.loadProject(projectId);
                let cloudProject: Awaited<ReturnType<typeof CloudStorage.loadProjectMetadata>> = null;

                // If not found locally, try downloading from cloud
                if (!loadedProject && isAuthed) {
                    setLoadingStatus('Downloading project from cloud...');
                    cloudProject = await CloudStorage.loadProjectMetadata(projectId);
                    if (!cloudProject) {
                        navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                        return;
                    }
                    const project = cloudProject.project_data;
                    project.id = projectId;
                    await ProjectStorage.saveProject(project);
                    await ProjectStorage.saveSyncMeta({
                        projectId,
                        userId: cloudProject.user_id,
                        cloudVersion: cloudProject.cloud_version,
                        uploadStatus: cloudProject.upload_status === 'ready' ? 'ready' : 'pending',
                        lastSyncedAt: Date.now(),
                        lastAccessedAt: Date.now(),
                    });
                    loadedProject = await ProjectStorage.loadProject(projectId);
                }

                if (!loadedProject) {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                    return;
                }

                // Sync local ↔ cloud versions on open
                if (isAuthed) {
                    try {
                        const syncMeta = await ProjectStorage.getSyncMeta(projectId);
                        const localVersion = syncMeta?.cloudVersion ?? 0;
                        const cloudVersion = await CloudStorage.getCloudVersion(projectId);

                        if (cloudVersion !== null && cloudVersion > localVersion) {
                            setLoadingStatus('Syncing project...');
                            cloudProject = await CloudStorage.loadProjectMetadata(projectId);
                            if (cloudProject?.project_data) {
                                const project = cloudProject.project_data as typeof loadedProject;
                                project!.id = projectId;
                                await ProjectStorage.saveProject(project!);
                                await ProjectStorage.saveSyncMeta({
                                    projectId,
                                    userId: syncMeta?.userId ?? useUserStore.getState().userId ?? '',
                                    cloudVersion: cloudProject.cloud_version,
                                    uploadStatus: syncMeta?.uploadStatus ?? 'ready',
                                    lastSyncedAt: Date.now(),
                                    lastAccessedAt: Date.now(),
                                });
                                loadedProject = await ProjectStorage.loadProject(projectId);
                                console.log(`[Editor] Loaded newer cloud version (v${cloudVersion} > local v${localVersion})`);
                            }
                        } else if (cloudVersion !== null && cloudVersion < localVersion) {
                            const { userId, isPro } = useUserStore.getState();
                            if (userId) {
                                SyncService.syncNow(loadedProject!, userId, isPro).catch(err => {
                                    console.warn('[Editor] Failed to push local version to cloud on open:', err);
                                });
                            }
                        }
                    } catch (err) {
                        console.warn('[Editor] Cloud version check failed, using local:', err);
                    }
                }

                // Check for missing media blobs and download from cloud
                const missingMedia = loadedProject!.screenSource?.storageUrl && !loadedProject!.screenSource?.runtimeUrl
                    || loadedProject!.cameraSource?.storageUrl && !loadedProject!.cameraSource?.runtimeUrl
                    || loadedProject!.microphoneSource?.storageUrl && !loadedProject!.microphoneSource?.runtimeUrl;

                if (missingMedia && isAuthed) {
                    setLoadingStatus('Downloading media...');
                    if (!cloudProject) {
                        cloudProject = await CloudStorage.loadProjectMetadata(projectId);
                    }
                    if (cloudProject) {
                        await SyncService.downloadProjectMedia(projectId, cloudProject);
                        // Re-hydrate now that blobs are in IndexedDB
                        loadedProject = await ProjectStorage.loadProject(projectId);
                    }

                    // Verify media loaded successfully
                    const stillMissing = loadedProject!.screenSource?.storageUrl && !loadedProject!.screenSource?.runtimeUrl;
                    if (stillMissing) {
                        setLoadError('Could not load project media. Please contact support.');
                        setIsLoading(false);
                        return;
                    }
                }

                loadProject(loadedProject!);
                setIsLoading(false);
                trackEditorLoaded();

                // Update local last-accessed timestamp
                ProjectStorage.touchSyncMetaAccess(loadedProject!.id).catch(console.error);

                // Warm the share cache eagerly so Header/ExportSettings don't hit the DB on mount
                if (isAuthed) {
                    ShareService.getShareForProject(loadedProject!.id);
                    CloudStorage.updateLastAccessed(loadedProject!.id).catch(console.error);
                }

            } catch (err: any) {
                console.error("Project Init Failed:", err);
                // If we got far enough to have a project but media failed, show error in editor
                if (loadingStatus === 'Downloading media...') {
                    setLoadError('Could not load project media. Please contact support.');
                    setIsLoading(false);
                } else {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                }
            }
        }

        init();
    }, []);

    // Flush pending cloud syncs on page unload
    useEffect(() => {
        const handleBeforeUnload = () => {
            const { project, userEvents } = useProjectStore.getState();
            const { userId, isPro } = useUserStore.getState();
            const fullProject = { ...project, userEvents };
            SyncService.flushPendingSync(fullProject, userId, isPro);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // Global Key Listener for Undo/Redo & Play/Pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
                return;
            }

            // Blur any focused button so Space doesn't natively click it,
            // then fall through to play/pause.
            if (e.code === 'Space' && activeTag === 'button') {
                (document.activeElement as HTMLElement)?.blur();
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                return;
            }

            if (e.code === 'Space') {
                e.preventDefault(); // Prevent scrolling
                const { isPlaying, setIsPlaying, currentTimeMs, setCurrentTime } = useUIStore.getState();
                if (!isPlaying) {
                    const windows = useProjectStore.getState().project.timeline.outputWindows;
                    const tm = getTimeMapper(windows);
                    if (currentTimeMs >= tm.outputDuration) {
                        setCurrentTime(0);
                    }
                }
                setIsPlaying(!isPlaying);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);


    // Handle Resize for Centering
    useEffect(() => {
        if (!containerElement) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        ro.observe(containerElement);
        return () => ro.disconnect();
    }, [containerElement]);


    // Derived UI State
    // Check if we have a valid screen source to determine if project is "active" / has content
    const hasActiveProject = !!project.screenSource?.id;
    const projectOutputSize = project.settings.outputSize;

    // Calculate Rendered Rect (for overlay positioning)
    let renderedStyle = { width: '100%', height: '100%' };
    if (projectOutputSize && projectOutputSize.width > 0 && containerSize.width > 0 && containerSize.height > 0) {
        const containerAspect = containerSize.width / containerSize.height;
        const videoAspect = projectOutputSize.width / projectOutputSize.height;

        let rw, rh;
        if (containerAspect > videoAspect) {
            rh = containerSize.height;
            rw = rh * videoAspect;
        } else {
            rw = containerSize.width;
            rh = rw / videoAspect;
        }

        renderedStyle = {
            width: `${rw}px`,
            height: `${rh}px`
        };
    }

    // No project loaded and not loading — redirect to dashboard
    if (!isLoading && !loadError && !hasActiveProject) {
        navigate('/');
        return null;
    }

    return (
        <div id="editor-root" className="w-full h-screen bg-surface-body flex flex-col overflow-auto" style={{ minWidth: '800px' }}>

            {/* Project loading / error modal — blocks editor until ready */}
            <Modal isOpen={isLoading || !!loadError} maxWidth="max-w-sm">
                <div className="flex flex-col items-center gap-4 text-center py-2">
                    {loadError ? (
                        <>
                            <div className="text-text-highlighted font-semibold text-lg">Failed to Load Project</div>
                            <p className="text-text-main text-sm">{loadError}</p>
                            <div className="flex gap-3 mt-2">
                                <button
                                    onClick={() => navigate('/')}
                                    className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-highlighted text-sm rounded-lg border border-border transition-colors"
                                >
                                    Back to Dashboard
                                </button>
                                <a
                                    href="mailto:support@recordio.cc"
                                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors"
                                >
                                    Contact Support
                                </a>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="spinner w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <div className="text-text-main text-sm">{loadingStatus}</div>
                        </>
                    )}
                </div>
            </Modal>

            {/* Header / Toolbar */}
            <Header />

            {showDebugBar && (
                <div className="bg-surface-raised border-b border-border flex flex-col shrink-0 z-[var(--z-index-overlay)] select-none">
                    {/* Bottom Row: Debug Tools */}
                    <DebugBar />
                </div>
            )}

            <div id="editor-body" className="flex-1 flex overflow-hidden">
                <SettingsPanel />
                <ExportModal />
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center"
                >
                    <div
                        id="canvas-sizing-container"
                        ref={setContainerElement}
                        className="relative flex items-center bg-surface-body justify-center shadow-2xl"
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >

                        {hasActiveProject && (
                            <div
                                id="canvas-rendered-wrapper"
                                style={{ position: 'relative', ...renderedStyle }}
                            >
                                <CanvasContainer />
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <TimelineToolbar />

            <div id="timeline-container" className="border-t border-border shrink-0 z-[var(--z-index-navbar)] bg-surface">
                <Timeline />
            </div>

            <ConflictModal />
            <ProgressModal
                isOpen={isExporting}
                title={
                    exportPhase === 'uploading' ? 'Publishing Video'
                        : exportPhase === 'preparing' ? 'Preparing Export'
                            : 'Exporting Project'
                }
                projectName={project.name}
                progress={exportProgress}
                statusText={
                    exportPhase === 'uploading'
                        ? `Uploading... ${Math.round(exportProgress * 100)}%`
                        : exportPhase === 'preparing'
                            ? 'Analyzing video...'
                            : timeRemainingSeconds !== null
                                ? `~${formatTimeCode(timeRemainingSeconds * 1000)} remaining`
                                : 'Estimating time...'
                }
                decodeFallback={!!decodeFallback}
                onCancel={() => {
                    const manager = (window as any).__activeExportManager;
                    if (manager) {
                        manager.cancel();
                    }
                }}
            />
        </div>
    );
}

export default Editor;
