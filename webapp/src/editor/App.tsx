import { useState, useEffect } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';

import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';
import { TimelineToolbar } from './components/timeline/TimelineToolbar';
import { useUIStore } from './stores/useUIStore';
import { getTimeMapper } from './hooks/useTimeMapper';


import { CloudProjectService } from '../storage/cloudProjectService';
import { useMediaUrlStore } from '../storage/useMediaUrlStore';
import { useAssetLibraryStore } from './stores/useAssetLibraryStore';
import { Modal } from '@shared/components';
import { SUPPORT_EMAIL } from '@shared/types/bridge';
import { DebugBar } from './components/DebugBar';
import { Header } from './components/header/Header';
import { ConflictModal } from './components/ConflictModal';
import { SyncFailedModal } from './components/SyncFailedModal';
import { AuthModal } from '../auth/AuthModal';



import { useUserStore } from '../auth/useUserStore';
import { AuthManager } from '../auth/AuthManager';
import { trackEditorPageLoaded, trackProjectLoadFailed } from '../core/analytics';
import { captureError } from '../utils/sentry';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { navigate } from '../navigate';

function Editor() {
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();
    const loadProject = useProjectStore(s => s.loadProject);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const showDebugBar = useUIStore(s => s.showDebugBar);



    // Initialization State
    const [isLoading, setIsLoading] = useState(true);
    const [loadingStatus, setLoadingStatus] = useState('Loading project...');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [needsAuth, setNeedsAuth] = useState(false);
    const isAuthenticated = useUserStore(s => s.isAuthenticated);

    const saveProject = useProjectStore(s => s.saveProject);


    // Once user signs in after being prompted, reload the project
    useEffect(() => {
        if (needsAuth && isAuthenticated) {
            setNeedsAuth(false);
            setIsLoading(true);
            setLoadingStatus('Loading project...');
            // Re-run init by triggering a re-mount via navigate
            const url = window.location.pathname + window.location.search + window.location.hash;
            navigate(url, { replace: true });
            window.location.reload();
        }
    }, [needsAuth, isAuthenticated]);

    // Clean up OAuth callback hash if present
    useEffect(() => {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (hashParams.get('access_token')) {
            setTimeout(() => { window.location.hash = ''; }, 1000);
        }
    }, []);


    // Load Project ID from URL
    useEffect(() => {
        let cancelled = false;
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('projectId');

        async function init() {
            if (!projectId) {
                navigate('/', { replace: true });
                return;
            }

            await AuthManager.ready;
            if (cancelled) return;

            const isAuthed = useUserStore.getState().isAuthenticated;
            if (!isAuthed) {
                setNeedsAuth(true);
                setIsLoading(false);
                return;
            }

            try {
                useMediaUrlStore.getState().revokeAll();

                const result = await CloudProjectService.loadProject(projectId, setLoadingStatus);

                if (cancelled) return;

                if (!result) {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                    return;
                }

                loadProject(result.project, result.name);
                setIsLoading(false);
                trackEditorPageLoaded(useWorkspaceStore.getState().workspaceId, projectId);

                // Load asset library in background (non-blocking)
                useAssetLibraryStore.getState().load().catch(err =>
                    captureError(err, { flow: 'asset_library', phase: 'load' })
                );


            } catch (err: any) {
                if (cancelled) return;
                captureError(err, {
                    flow: 'project_load',
                    phase: loadingStatus,
                    projectId,
                });
                trackProjectLoadFailed({
                    project_id: projectId,
                    error: err?.message || 'Unknown error',
                    error_name: err?.name,
                    is_offline: !navigator.onLine,
                    loading_status: loadingStatus,
                });
                if (loadingStatus.includes('media') || loadingStatus.includes('Loading Project')) {
                    setLoadError('Could not load project media. Please contact support.');
                    setIsLoading(false);
                } else {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                }
            }
        }

        init();
        return () => { cancelled = true; };
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
    const hasActiveProject = !!project.screenSource?.storagePath;
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
    if (!isLoading && !loadError && !needsAuth && !hasActiveProject) {
        navigate('/');
        return null;
    }

    // Auth required — show sign-in modal directly
    if (needsAuth) {
        return (
            <div id="editor-root" className="w-full h-screen bg-surface-body flex flex-col items-center justify-center" style={{ minWidth: '800px' }}>
                <AuthModal isOpen={true} onClose={() => navigate('/')} />
            </div>
        );
    }

    return (
        <div id="editor-root" className="w-full h-screen bg-surface-body flex flex-col overflow-auto" style={{ minWidth: '800px' }}>

            {/* Error modal — only shown on load failure */}
            <Modal isOpen={!!loadError} maxWidth="max-w-sm">
                <div className="flex flex-col items-center gap-4 text-center py-2">
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
                            href={`mailto:${SUPPORT_EMAIL}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors"
                        >
                            Contact Support
                        </a>
                    </div>
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

                        {isLoading ? (
                            <div className="flex flex-col items-center gap-4">
                                <div className="spinner w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <div className="text-text-main text-sm">{loadingStatus}</div>
                            </div>
                        ) : hasActiveProject ? (
                            <div
                                id="canvas-rendered-wrapper"
                                style={{ position: 'relative', ...renderedStyle }}
                            >
                                <CanvasContainer />
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            <TimelineToolbar />

            <div id="timeline-container" className="border-t border-border shrink-0 z-[var(--z-index-navbar)] bg-surface">
                <Timeline />
            </div>

            <ConflictModal />
            <SyncFailedModal onRetry={() => { saveProject(); }} />
        </div>
    );
}

export default Editor;
