import { useState, useEffect, useRef } from 'react';
import { PlayerCanvas } from './player/PlayerCanvas';
import { BackgroundPanel } from './BackgroundPanel';
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
import type { Source, MainTrack } from '../core/types';
import { ViewTransform } from '../core/effects/viewTransform';
import { calculateZoomSchedule } from '../core/effects/cameraMotion';
import { generateMouseEffects } from '../core/effects/mouseEffects';




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
                const screenSourceId = `source-${data.recordingStartTime}-screen`;
                const cameraSourceId = `source-${data.recordingStartTime}-camera`;

                const currentProject = useProjectStore.getState().project;

                let startProject = currentProject;
                let isNew = false;

                if (!startProject.sources[screenSourceId]) {
                    console.log('Initializing Project for Session:', data.recordingStartTime);
                    startProject = ProjectImpl.create('Recording ' + (new Date(data.recordingStartTime).toLocaleTimeString()));
                    isNew = true;
                }

                // Add Screen Source
                if (!startProject.sources[screenSourceId]) {
                    const source: Source = {
                        id: screenSourceId,
                        type: 'video',
                        url: data.videoUrl,
                        durationMs: 0,
                        size: { width: 0, height: 0 },
                        hasAudio: true,
                        events: data.metadata || []
                    };
                    startProject = ProjectImpl.addSource(startProject, source);
                }

                // Add Camera Source
                if (data.cameraUrl && !startProject.sources[cameraSourceId]) {
                    const source: Source = {
                        id: cameraSourceId,
                        type: 'video',
                        url: data.cameraUrl,
                        durationMs: 0,
                        size: { width: 0, height: 0 },
                        hasAudio: true // Camera usually has the Mic
                    };
                    startProject = ProjectImpl.addSource(startProject, source);
                }

                if (isNew || startProject !== currentProject) {
                    loadProject(startProject);
                }
            }
        });
    }, []);

    // Reactive Project Initialization: Create Tracks once Sources are ready
    useEffect(() => {
        const proj = useProjectStore.getState().project;
        const mainTrack = proj.timeline.mainTrack;
        const overlayTrack = proj.timeline.overlayTrack;

        const screenSourceId = Object.keys(proj.sources).find(id => id.includes('screen'));
        const cameraSourceId = Object.keys(proj.sources).find(id => id.includes('camera'));

        // 1. Initialize Main Track (Screen)
        if (mainTrack.clips.length === 0 && screenSourceId) {
            const source = proj.sources[screenSourceId];
            if (source.size.width > 0 && source.durationMs > 0) {
                console.log('Screen Source Ready, Creating Main Track');

                let track = TrackImpl.createMainTrack('Screen Recording');

                // Generate Metadata Effects
                if (source.events && source.events.length > 0) {
                    const viewTransform = new ViewTransform(
                        source.size,
                        proj.outputSettings.size,
                        track.displaySettings.padding
                    );
                    track.cameraMotions = calculateZoomSchedule(maxZoom, viewTransform, source.events);
                    track.mouseEffects = generateMouseEffects(source.events, source.durationMs);
                }

                const clip = ClipImpl.create(source.id, 0, source.durationMs, 0);
                const trackWithClip = TrackImpl.addClip(track, clip) as MainTrack;

                const newTimeline = { ...proj.timeline, mainTrack: trackWithClip };
                loadProject({ ...proj, timeline: newTimeline });
                // Return to avoid race conditions, let effect re-run
                return;
            }
        }

        // 2. Initialize Overlay Track (Camera)
        // Only if we have a camera source and no overlay track (or empty overlay track)
        if (cameraSourceId && (!overlayTrack || overlayTrack.clips.length === 0)) {
            const source = proj.sources[cameraSourceId];
            // Wait for metadata
            if (source.size.width > 0 && source.durationMs > 0) {
                console.log('Camera Source Ready, Creating Overlay Track');

                let track = overlayTrack;
                if (!track) {
                    track = {
                        id: crypto.randomUUID(),
                        type: 'overlay', // or 'video'
                        name: 'Camera',
                        clips: [],
                        muted: false,
                        locked: false,
                        visible: true
                    };
                }

                // Create Clip
                // Usually camera starts at 0.
                const clip = ClipImpl.create(source.id, 0, source.durationMs, 0);
                const trackWithClip = TrackImpl.addClip(track, clip);

                const newTimeline = { ...proj.timeline, overlayTrack: trackWithClip };
                loadProject({ ...proj, timeline: newTimeline });
            }
        }
    }, [project.sources, project.outputSettings, project.timeline]);


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
