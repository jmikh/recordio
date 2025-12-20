import { useState, useEffect, useRef } from 'react';
import { PlayerCanvas } from './player/PlayerCanvas';
// import { useEditorStore } from './store'; // REMOVED
import { loadSessionData } from './session/sessionLoader';
import { useProjectStore, useProjectData, useMaxZoom } from './stores/useProjectStore';
// import { usePlaybackStore } from './stores/usePlaybackStore';
import { Timeline } from './timeline/Timeline';
import { EventInspector } from './EventInspector';
import { HoverInspector } from './HoverInspector';
// import { useProject } from '../hooks/useProject'; // REMOVED
import { ProjectImpl } from '../core/project/project';
// import { TimelineImpl } from '../core/timeline/timeline'; // Unused
import { TrackImpl } from '../core/timeline/track';
import { ClipImpl } from '../core/timeline/clip';
import type { Source } from '../core/types';
// import type { UserEvent } from '../core/types';
import { ViewTransform } from '../core/effects/viewTransform';
import { calculateZoomSchedule } from '../core/effects/cameraMotion';
import { generateMouseEffects } from '../core/effects/mouseEffects';
import { type ZoomConfig } from '../core/types';




function Editor() {
    const containerRef = useRef<HTMLDivElement>(null);

    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();
    const loadProject = useProjectStore(s => s.loadProject);
    const maxZoom = useMaxZoom(); // Selected from project

    // Load Session & Initialize Project
    useEffect(() => {
        loadSessionData().then(data => {
            if (data.videoUrl && data.recordingStartTime) {
                // Initialize Project if needed
                // For now, we just ensure a backing store source exists.
                // In a robust app, we'd check if specific ID exists.

                const sourceId = `source-${data.recordingStartTime}`;
                const currentProject = useProjectStore.getState().project;

                if (!currentProject.sources[sourceId]) {
                    console.log('Initializing Project for Source:', sourceId);

                    let newProject = ProjectImpl.create('Recording ' + (new Date(data.recordingStartTime).toLocaleTimeString()));

                    // We don't know duration/size yet, PlayerCanvas will update it later.
                    // We create a "Skeleton" source.
                    const source: Source = {
                        id: sourceId,
                        type: 'video',
                        url: data.videoUrl,
                        durationMs: 0, // Unknown
                        size: { width: 0, height: 0 }, // Unknown
                        hasAudio: true,
                        events: data.metadata || []
                    };

                    newProject = ProjectImpl.addSource(newProject, source);
                    loadProject(newProject);
                }
            }
        });
    }, []);

    // Reactive Project Initialization: Create Tracks once Source is ready
    // We watch for a source that has valid dimensions but is not yet in a track.
    useEffect(() => {
        const proj = useProjectStore.getState().project;
        const mainTrack = proj.timeline.mainTrack;

        // If we have no clips but we do have a valid source...
        // (Simplified logic: assumes 1 source = 1 track project for now)
        if (mainTrack.clips.length === 0) {
            const sourceIds = Object.keys(proj.sources);
            if (sourceIds.length > 0) {
                const source = proj.sources[sourceIds[0]];
                // Wait for metadata load (size > 0)
                if (source.size.width > 0 && source.durationMs > 0) {
                    console.log('Source Ready, Creating Default Track/Clip', source.id);

                    // Create defaults
                    let track = TrackImpl.create('Main Video', 'video');

                    // 1. Generate Camera Motions from Metadata
                    if (source.events && source.events.length > 0) {
                        const zoomConfig: ZoomConfig = {
                            zoomIntensity: maxZoom,
                            zoomDuration: 2000,
                            zoomOffset: -500
                        };
                        const videoMappingConfig = new ViewTransform(
                            source.size,
                            proj.outputSettings.size,
                            0
                        );
                        track.cameraMotions = calculateZoomSchedule(zoomConfig, videoMappingConfig, source.events);
                        track.mouseEffects = generateMouseEffects(source.events, source.durationMs);
                    }

                    const clip = ClipImpl.create(source.id, 0, source.durationMs, 0);
                    track = TrackImpl.addClip(track, clip);

                    // Update Project
                    const newTimeline = { ...proj.timeline, mainTrack: track };
                    loadProject({ ...proj, timeline: newTimeline });
                }
            }
        }
    }, [project.sources, project.outputSettings]); // React to source updates


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

    // Derived Video URL for "Loading" state check
    const hasActiveProject = Object.keys(project.sources).length > 0;

    // Optimization: Don't depend on currentTimeMs in effect dependency if possible.
    // But we need the initial value. 
    // Actually, setting state inside loop is fine, but reading it?
    // We should use a ref for local accumulating time to avoid effect re-run loop?
    // Yes.

    // Better Loop Implementation:


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

    // Calculate Schedule when metadata/video ready


    // Video Dimensions & Rendering Logic - Moved to top


    // Visualization Update Loop
    // Removed overlay visualization logic as it moved to PlayerCanvas


    // Derived State from Project (Restored for Layout/Debug)
    const outputVideoSize = project?.outputSettings?.size || { width: 1920, height: 1080 };
    // TODO: Do not rely on source[0], find the correct active source or main source.
    const inputVideoSize = Object.values(project.sources || {})[0]?.size || null;

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
        // inputVideoSize from store
        if (!inputVideoSize || !inputVideoSize.width || Object.keys(renderedStyle).length === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Rendered Width/Height
        const rw = (renderedStyle as any).width;
        const rh = (renderedStyle as any).height;

        // Calculate coords relative to source video
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



    return (
        <div className="w-full h-screen bg-black flex flex-col overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
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

                                {/* All event markers (faint) */}
                                {/* metadata logic moved to tracks, removing manual overlay map if any */}
                            </div>
                        )}
                        {!hasActiveProject && <div className="text-white">Loading Project...</div>}
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
                        <button
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
                            onClick={() => console.log(project)}
                        >
                            Log Project Struct
                        </button>
                    </div>
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="flex-1 flex flex-col overflow-hidden min-h-0 border-b border-[#333]">
                            <EventInspector metadata={inputVideoSize ? Object.values(project.sources)[0]?.events || [] : []} />
                        </div>
                        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                            <HoverInspector events={inputVideoSize ? Object.values(project.sources)[0]?.events || [] : []} inputSize={inputVideoSize || { width: 1920, height: 1080 }} />
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
