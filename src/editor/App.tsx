import { useState, useEffect, useRef } from 'react';
import { PlayerCanvas } from './player/PlayerCanvas';
import { BackgroundPanel } from './BackgroundPanel';
import { useProjectStore, useProjectData } from './stores/useProjectStore';
import { Timeline } from './timeline/Timeline';
import { EventInspector } from './EventInspector';
import { HoverInspector } from './HoverInspector';
import { ProjectLibrary } from '../core/project/ProjectLibrary';

// Legacy event merging helpers (to be refactored into ProjectLibrary eventually)
import { calculateDragEvents } from '../core/effects/dragEffects';
import type { ClickEvent, KeyboardEvent, UserEvent } from '../core/types';


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

                // --- METADATA HYDRATION (Legacy/Gap Fill) ---
                // If the project was just created from Source, and Source has no events (because Recorder didn't capture them),
                // we try to load them from chrome.storage.local (where Content Script put them).
                // This is a temporary bridge until Recorder captures events directly.

                const screenSourceId = loadedProject.timeline.recording.screenSourceId;
                const source = loadedProject.sources[screenSourceId];

                // Only merge if we don't have events yet
                if (source && (!source.events || source.events.length === 0)) {
                    console.log('Checking chrome.storage for metadata events...');
                    const storage = await chrome.storage.local.get(['recordingMetadata']);
                    const events = storage.recordingMetadata as UserEvent[];

                    if (events && events.length > 0) {
                        console.log(`Hydrating project with ${events.length} events from storage.`);
                        // We need to update the Project (and potentially the Source in IDB?)
                        // For now, just update the loaded project instance so the user can work.
                        // The "Save Project" action will persist these into the Project's recording events.
                        // Note: We are NOT updating the immutable Source in IDB here. That's fine.

                        // Parse events into Recording buckets
                        const clickEvents = events.filter(e => e.type === 'click') as ClickEvent[];
                        // @ts-ignore
                        const keyboardEvents = events.filter(e => e.type === 'keydown') as KeyboardEvent[];
                        const dragEvents = calculateDragEvents(events);

                        loadedProject.timeline.recording.clickEvents = clickEvents;
                        loadedProject.timeline.recording.keyboardEvents = keyboardEvents;
                        loadedProject.timeline.recording.dragEvents = dragEvents;

                        // Update Source (in memory) for inspectors
                        source.events = events;
                    }
                }

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
    const outputVideoSize = project?.outputSettings?.size || { width: 1920, height: 1080 };
    // TODO: support multi-source better
    const firstSource = Object.values(project.sources || {})[0];
    const inputVideoSize = firstSource?.size || null;

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

    // Tooltip Logic
    const [tooltip, setTooltip] = useState<{ x: number, y: number, text: string } | null>(null);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!inputVideoSize || !inputVideoSize.width || Object.keys(renderedStyle).length === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const rw = (renderedStyle as any).width;
        const rh = (renderedStyle as any).height;

        const scaleX = rw / inputVideoSize.width;
        const scaleY = rh / inputVideoSize.height;

        const sx = x / scaleX;
        const sy = y / scaleY;

        setTooltip({
            x: e.clientX + 15,
            y: e.clientY + 15,
            text: `X: ${Math.round(sx)}, Y: ${Math.round(sy)}`
        });
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };


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
                                onMouseMove={handleMouseMove}
                                onMouseLeave={handleMouseLeave}
                            >
                                <PlayerCanvas />
                            </div>
                        )}
                        {isLoading && <div className="text-white">Loading Project...</div>}
                    </div>

                    {/* Tooltip */}
                    {tooltip && (
                        <div style={{
                            position: 'fixed',
                            left: tooltip.x + 10,
                            top: tooltip.y + 10,
                            zIndex: 9999,
                            background: 'rgba(0, 0, 0, 0.8)',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap'
                        }}>
                            {tooltip.text}
                        </div>
                    )}
                </div>

                <div id="debug-side-panel" className="w-80 bg-[#252526] border-l border-[#333] flex flex-col overflow-hidden text-xs text-gray-300">
                    <div className="p-2 border-b border-[#333]">
                        <h3 className="font-bold mb-2">Project: {project.name}</h3>
                        <div className="text-[10px] text-gray-500">ID: {project.id}</div>
                    </div>
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="flex-1 flex flex-col overflow-hidden min-h-0 border-b border-[#333]">
                            <EventInspector metadata={inputVideoSize && firstSource ? firstSource.events || [] : []} />
                        </div>
                        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                            <HoverInspector events={inputVideoSize && firstSource ? firstSource.events || [] : []} inputSize={inputVideoSize || { width: 1920, height: 1080 }} />
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
