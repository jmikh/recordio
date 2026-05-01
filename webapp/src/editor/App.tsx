import { useState, useEffect } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';

import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';
import { TimelineToolbar } from './components/timeline/TimelineToolbar';
import { useUIStore } from './stores/useUIStore';
import { getTimeMapper } from './hooks/useTimeMapper';


import { CloudProjectService } from '../storage/cloudProjectService';
import { useMediaUrlStore } from './stores/useMediaUrlStore';
import { useAssetLibraryStore } from './stores/useAssetLibraryStore';
import { Modal } from '@shared/components';
import { DebugBar } from './components/DebugBar';
import { Header } from './components/header/Header';
import { ConflictModal } from './components/ConflictModal';
import { SyncFailedModal } from './components/SyncFailedModal';



import { useUserStore } from './stores/useUserStore';
import { trackEditorLoaded } from '../core/analytics';
import { navigate } from '../navigate';
import { usePendingUploadStore } from '../storage/pendingUploadStore';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';

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

    // Background upload: kicks off media upload for freshly imported projects
    const projectId = new URLSearchParams(window.location.search).get('projectId');
    const saveProject = useProjectStore(s => s.saveProject);
    const { retry: retryUpload } = useBackgroundUpload(projectId, () => {
        // Upload complete — flush any buffered edits
        saveProject();
    });


    // Clean up OAuth callback hash if present
    useEffect(() => {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (hashParams.get('access_token')) {
            setTimeout(() => { window.location.hash = ''; }, 1000);
        }
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

            const isAuthed = useUserStore.getState().isAuthenticated;
            if (!isAuthed) {
                navigate('/', { replace: true });
                return;
            }

            try {
                // If we just imported this project, blob URLs are already set
                // in useMediaUrlStore by importRecordingLocal — don't revoke them.
                const hasPendingUpload = usePendingUploadStore.getState().pending?.projectId === projectId;
                if (!hasPendingUpload) {
                    useMediaUrlStore.getState().revokeAll();
                }

                const result = await CloudProjectService.loadProject(projectId, setLoadingStatus);

                if (!result) {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                    return;
                }

                loadProject(result.project, result.name);
                setIsLoading(false);
                trackEditorLoaded();

                // Load asset library in background (non-blocking)
                useAssetLibraryStore.getState().load().catch(console.error);


            } catch (err) {
                console.error('[Editor] Project init failed:', err);
                if (loadingStatus.includes('media') || loadingStatus.includes('Loading screen') || loadingStatus.includes('Loading camera') || loadingStatus.includes('Loading audio')) {
                    setLoadError('Could not load project media. Please contact support.');
                    setIsLoading(false);
                } else {
                    navigate(`/?error=${encodeURIComponent('Project not found')}`, { replace: true });
                }
            }
        }

        init();
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
            <SyncFailedModal onRetry={retryUpload} />
        </div>
    );
}

export default Editor;
