import { useState, useEffect } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';

import { ProjectStorage } from '../storage/projectStorage';

// Icons
const IconUndo = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
);

const IconRedo = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 7v6h-6" />
        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7" />
    </svg>
);


function Editor() {
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();
    const userEvents = useProjectStore(s => s.userEvents);

    const loadProject = useProjectStore(s => s.loadProject);
    const isSaving = useProjectStore(s => s.isSaving);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);


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

    // Global Key Listener for Undo/Redo
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
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
        return (
            <div className="w-full h-screen bg-black flex items-center justify-center text-red-500">
                Error: {error}
            </div>
        );
    }

    // Welcome / Empty State
    if (!isLoading && !hasActiveProject) {
        // Check if we have a projectId param but failed? No, error handles that.
        // This is "No Project Loaded" state.
        return (
            <div className="w-full h-screen bg-[#1e1e1e] flex items-center justify-center text-white flex-col gap-4">
                <h1 className="text-2xl font-bold">Recordo Editor</h1>
                <p className="text-gray-400">Select a project to load (Sidebar coming soon) or start a new recording.</p>
                {/* Temporary list trigger validation? */}
            </div>
        );
    }

    return (
        <div className="w-full h-screen bg-black flex flex-col overflow-hidden">

            {/* Header / Toolbar */}
            <div className="h-12 bg-[#252526] border-b border-[#333] flex items-center px-4 justify-between shrink-0 z-30 select-none">
                <div className="flex items-center gap-4">
                    <h1 className="font-bold text-gray-200 text-sm tracking-wide">RECORDO</h1>
                    <div className="h-4 w-[1px] bg-[#444] mx-2"></div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#333] rounded disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <IconUndo />
                        </button>
                        <button
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="p-2 text-gray-400 hover:text-white hover:bg-[#333] rounded disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <IconRedo />
                        </button>
                    </div>

                    <div className="text-[10px] text-gray-500 ml-4">
                        {pastStates.length} / {futureStates.length}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                        {isSaving ? (
                            <span className="text-blue-400">Saving...</span>
                        ) : (
                            <span className="text-gray-600">All changes saved</span>
                        )}
                    </div>
                    {/* User Profile / Other Actions */}
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500"></div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <SettingsPanel />
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center bg-[#1e1e1e]"
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


                <div id="debug-side-panel" className="w-80 bg-[#252526] border-l border-[#333] flex flex-col overflow-hidden text-xs text-gray-300">
                    <div className="p-2 border-b border-[#333]">
                        <h3 className="font-bold mb-2">Project: {project.name}</h3>
                        <div className="text-[10px] text-gray-500">ID: {project.id}</div>
                        <button
                            className="mt-2 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
                            onClick={() => console.log(project)}
                        >
                            Log Project
                        </button>
                        <button
                            className="mt-2 px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
                            onClick={() => console.log(userEvents)}
                        >
                            Log User Events
                        </button>
                    </div>
                </div>

            </div>

            <div id="timeline-container" className="h-64 border-t border-[#333] shrink-0 z-20 bg-[#1e1e1e] flex flex-col">
                <Timeline />
            </div>
        </div>
    );
}

export default Editor;
