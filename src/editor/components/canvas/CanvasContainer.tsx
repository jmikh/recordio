import { useRef, useEffect } from 'react';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { ProjectStorage } from '../../../storage/projectStorage';

import { PlaybackRenderer, type RenderResources } from './PlaybackRenderer';
import { renderZoomEditor, ZoomEditor } from './ZoomEditor';
import { CameraEditor } from './CameraEditor';
import { drawBackground } from '../../../core/painters/backgroundPainter';
import { TimeMapper } from '../../../core/timeMapper';
import type { CameraSettings } from '../../../core/types';

export const CanvasContainer = () => {
    const project = useProjectData();
    const editingZoomId = useProjectStore(s => s.editingZoomId);
    const editingCamera = useProjectStore(s => s.editingCamera);

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };
    const sources = useProjectSources();

    // DOM Refs for Resources
    const internalVideoRefs = useRef<{ [sourceId: string]: HTMLVideoElement }>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement>(null);

    // Mutable State for Dragging (60fps preview)
    const previewCameraSettingsRef = useRef<CameraSettings | null>(null);

    // Loop State
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);

    // -----------------------------------------------------------
    // RENDER LOOP
    // -----------------------------------------------------------
    useEffect(() => {
        let lastFpsTime = 0;

        const tick = (time: number) => {
            const pbState = usePlaybackStore.getState();
            const { editingZoomId, project, sources, userEvents } = useProjectStore.getState();

            // FPS Logging (Optional)
            if (time - lastFpsTime >= 1000) lastFpsTime = time;

            // Only advance time if NOT editing
            if (pbState.isPlaying && !editingZoomId) {
                if (lastTimeRef.current === 0) lastTimeRef.current = time;
                const delta = time - lastTimeRef.current;
                const safeDelta = Math.min(delta, 100);

                if (safeDelta > 0) {
                    let nextTime = pbState.currentTimeMs + safeDelta;
                    // Gap Skipping Logic
                    const windows = project.timeline.outputWindows;
                    const activeWindow = windows.find(w => nextTime >= w.startMs && nextTime < w.endMs);
                    if (!activeWindow) {
                        const nextWin = windows.find(w => w.startMs > nextTime);
                        if (nextWin) nextTime = nextWin.startMs;
                        else {
                            pbState.setIsPlaying(false);
                            const lastWin = windows[windows.length - 1];
                            nextTime = lastWin ? lastWin.endMs : 0;
                        }
                    }
                    pbState.setCurrentTime(nextTime);
                }
                lastTimeRef.current = time;
            } else {
                lastTimeRef.current = 0;
            }

            // PERFORM RENDER
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');

            if (canvas && ctx) {
                // 1. CLEAR & BACKGROUND
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                drawBackground(ctx, project.settings, canvas, bgRef.current);

                // 2. DETERMINE FRAME TIME
                let effectiveTimeMs = pbState.currentTimeMs;

                if (editingZoomId) {
                    // Calculate Keyframe Time
                    const motion = project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId);
                    if (motion) {
                        const recording = project.timeline.recording;
                        const timeMapper = new TimeMapper(recording.timelineOffsetMs, project.timeline.outputWindows);
                        const outputTime = timeMapper.mapSourceToOutputTime(motion.sourceEndTimeMs);
                        if (outputTime !== -1) {
                            effectiveTimeMs = timeMapper.mapOutputToTimelineTime(outputTime);
                        }
                    }
                }

                // 3. SYNC VIDEO
                const sourceTimeMs = effectiveTimeMs - project.timeline.recording.timelineOffsetMs;
                const isPlaying = pbState.isPlaying && !editingZoomId; // Only play internal video if in View Mode

                Object.values(sources).forEach(source => {
                    const video = internalVideoRefs.current[source.id];
                    if (video) {
                        syncVideo(video, sourceTimeMs / 1000, isPlaying);
                    }
                });

                // 4. STRATEGY
                const resources: RenderResources = {
                    canvas,
                    ctx,
                    bgRef: bgRef.current,
                    videoRefs: internalVideoRefs.current
                };

                if (editingZoomId) {
                    renderZoomEditor(resources, {
                        project,
                        sources,
                        currentTimeMs: effectiveTimeMs,
                        editingZoomId
                    });
                } else {
                    PlaybackRenderer.render(resources, {
                        project,
                        sources,
                        userEvents,
                        currentTimeMs: effectiveTimeMs,
                        overrideCameraSettings: previewCameraSettingsRef.current || undefined
                    });
                }
            }

            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, []);

    // -----------------------------------------------------------
    // LAYOUT & SIZING
    // -----------------------------------------------------------
    // Calculated directly via CSS aspect-ratio on the container

    // Canvas Resize Sync
    useEffect(() => {
        if (canvasRef.current && outputVideoSize) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;
        }
    }, [outputVideoSize.width, outputVideoSize.height]);


    // -----------------------------------------------------------
    // RESOURCE HELPERS
    // -----------------------------------------------------------
    const activeBgSourceId = project.settings.backgroundSourceId;
    const bgUrl = activeBgSourceId && sources[activeBgSourceId]
        ? sources[activeBgSourceId].url
        : project.settings.backgroundImageUrl;

    // Thumbnail Logic
    useEffect(() => {
        const captureThumbnail = () => {
            const canvas = canvasRef.current;
            if (!canvas || !project || !project.id) return;
            canvas.toBlob((blob) => {
                if (blob) ProjectStorage.saveThumbnail(project.id, blob).catch(console.warn);
            }, 'image/jpeg', 0.5);
        };
        const initialTimer = setTimeout(captureThumbnail, 3000);
        const interval = setInterval(captureThumbnail, 60000);
        return () => { clearTimeout(initialTimer); clearInterval(interval); };
    }, [project?.id]);

    // -----------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------

    return (
        <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">

            {/* ASPECT RATIO WRAPPER */}
            <div
                className="relative"
                style={{
                    aspectRatio: `${outputVideoSize.width} / ${outputVideoSize.height}`,
                    maxHeight: '100%',
                    maxWidth: '100%',
                    boxShadow: '0 0 0 1px #333' // Optional: Visual border for debugging/clarity
                }}
            >
                {/* HIDDEN RESOURCES LAYER */}
                <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
                    {project.settings.backgroundType === 'image' && bgUrl && (
                        <img ref={bgRef} src={bgUrl} className="hidden" crossOrigin="anonymous" />
                    )}
                    {Object.values(sources).map((source) => (
                        source.url ? (
                            <video
                                key={source.id}
                                ref={el => {
                                    if (el) internalVideoRefs.current[source.id] = el;
                                    else delete internalVideoRefs.current[source.id];
                                }}
                                src={source.url}
                                muted={true} // Muted for editor preview usually
                                playsInline
                                crossOrigin="anonymous"
                            />
                        ) : null
                    ))}
                </div>

                {/* MAIN CANVAS */}
                <canvas
                    ref={canvasRef}
                    className="block w-full h-full object-contain"
                />

                {/* ZOOM OVERLAY */}
                {editingZoomId && (
                    <ZoomEditor />
                )}

                {/* CAMERA OVERLAY */}
                {editingCamera && (
                    <CameraEditor cameraRef={previewCameraSettingsRef} />
                )}
            </div>
        </div>
    );
};

// Helper
const syncVideo = (video: HTMLVideoElement, desiredTimeS: number, isPlaying: boolean) => {
    if (isPlaying) {
        if (video.paused) video.play().catch(() => { });
        if (Math.abs(video.currentTime - desiredTimeS) > 0.2) video.currentTime = desiredTimeS;
    } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - desiredTimeS) > 0.001) video.currentTime = desiredTimeS;
    }
};
