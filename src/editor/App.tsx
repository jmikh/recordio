import { useState, useEffect } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';
import { useUIStore } from './stores/useUIStore';
import { useHistorySync } from './hooks/useHistorySync';


import { ProjectStorage } from '../storage/projectStorage';
import { ProjectSelector } from './components/ProjectSelector';
import { ProgressModal } from '../components/ui/ProgressModal';
import { formatTimeCode } from './utils';
import { DebugBar } from './components/DebugBar';
import { Header } from './components/Header';




function Editor() {
    useHistorySync();
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();

    const loadProject = useProjectStore(s => s.loadProject);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const showDebugBar = useUIStore(s => s.showDebugBar);

    // Export state (must be at top level - Rules of Hooks)
    const isExporting = useProjectStore(s => s.exportState.isExporting);
    const exportProgress = useProjectStore(s => s.exportState.progress);
    const timeRemainingSeconds = useProjectStore(s => s.exportState.timeRemainingSeconds);


    // Initialization State
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load Project ID from URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('projectId');

        async function init() {
            if (!projectId) {
                // No project ID - Show Welcome / Empty State
                setIsLoading(false);
                return;
            }
            try {
                console.log('Initializing Project:', projectId);
                const loadedProject = await ProjectStorage.loadProjectOrFail(projectId);
                loadProject(loadedProject);
            } catch (err: any) {
                console.error("Project Init Failed:", err);
                setError(err.message);
            } finally {
                setIsLoading(false);
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
                const { isPlaying, setIsPlaying } = useUIStore.getState();
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
    // Check if we have a valid screen source ID to determine if project is "active" / has content
    const hasActiveProject = !!project.timeline.recording.screenSourceId;
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



    if (error) {
        return <ProjectSelector error={error} />;
    }

    // Welcome / Empty State
    if (!isLoading && !hasActiveProject) {
        // This is "No Project Loaded" state.
        return <ProjectSelector />;
    }

    return (
        <div className="w-full h-screen bg-black flex flex-col overflow-auto" style={{ minWidth: '800px' }}>

            {/* Header / Toolbar */}
            <Header />

            {showDebugBar && (
                <div className="bg-[#252526] border-b border-[#333] flex flex-col shrink-0 z-30 select-none">
                    {/* Bottom Row: Debug Tools */}
                    <DebugBar />
                </div>
            )}

            <ProgressModal
                isOpen={isExporting}
                title="Exporting Project"
                projectName={project.name}
                progress={exportProgress}
                statusText={
                    timeRemainingSeconds !== null
                        ? `~${formatTimeCode(timeRemainingSeconds * 1000)} remaining`
                        : 'Estimating time...'
                }
                onCancel={() => {
                    const manager = (window as any).__activeExportManager;
                    if (manager) {
                        manager.cancel();
                    }
                }}
            />

            <div className="flex-1 flex overflow-hidden">
                <SettingsPanel />
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center bg-body"
                >
                    <div
                        ref={setContainerElement}
                        className="relative flex items-center justify-center shadow-2xl"
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >

                        {hasActiveProject && (
                            <div
                                className="bg-blue-200"
                                style={{ position: 'relative', ...renderedStyle }}
                            >
                                <CanvasContainer />
                            </div>
                        )}
                        {isLoading && <div className="text-white">Loading Project...</div>}
                    </div>
                </div>

            </div>

            <div id="timeline-container" className="border-t border-[#333] shrink-0 z-20 bg-[#1e1e1e]">
                <Timeline />
            </div>
        </div>
    );
}

export default Editor;
