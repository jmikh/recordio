import { useState, useEffect, useRef } from 'react';
import { PlayerCanvas } from './player/PlayerCanvas';
import { BackgroundPanel } from './BackgroundPanel';
import { useProjectStore, useProjectData } from './stores/useProjectStore';
import { Timeline } from './timeline/Timeline';

import { ProjectLibrary } from '../core/project/ProjectLibrary';



function Editor() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();
    const loadProject = useProjectStore(s => s.loadProject);


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
                const loadedProject = await ProjectLibrary.initProject(projectId);
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


    // Handle Resize for Centering
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);


    // Derived UI State
    const hasActiveProject = Object.keys(project.sources).length > 0;
    const outputVideoSize = project?.outputSettings.size;

    // Calculate Rendered Rect (for overlay positioning)
    let renderedStyle = {};
    if (outputVideoSize && outputVideoSize.width > 0) {
        const containerAspect = containerSize.width / containerSize.height;
        const videoAspect = outputVideoSize.width / outputVideoSize.height;

        let rw, rh;
        if (containerAspect > videoAspect) {
            rh = containerSize.height;
            rw = rh * videoAspect;
        } else {
            rw = containerSize.width;
            rh = rw / videoAspect;
        }

        renderedStyle = {
            width: rw,
            height: rh
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
            <div className="flex-1 flex overflow-hidden">
                <BackgroundPanel />
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center bg-[#1e1e1e]"
                >
                    <div
                        ref={containerRef}
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
                                <PlayerCanvas />
                            </div>
                        )}
                        {isLoading && <div className="text-white">Loading Project...</div>}
                    </div>
                </div>

                <div id="debug-side-panel" className="w-80 bg-[#252526] border-l border-[#333] flex flex-col overflow-hidden text-xs text-gray-300">
                    <div className="p-2 border-b border-[#333]">
                        <h3 className="font-bold mb-2">Project: {project.name}</h3>
                        <div className="text-[10px] text-gray-500">ID: {project.id}</div>
                    </div>
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {/* Inspectors Removed */}
                        </div>
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
