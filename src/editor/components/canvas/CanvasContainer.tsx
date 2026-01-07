import { useRef, useEffect } from 'react';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ProjectStorage } from '../../../storage/projectStorage';

import { PlaybackRenderer, type RenderResources } from './PlaybackRenderer';
import { ZoomEditor, renderZoomEditor } from './ZoomEditor';
import { renderCropEditor, CropEditor } from './CropEditor';
import { CameraEditor } from './CameraEditor';
import { drawBackground } from '../../../core/painters/backgroundPainter';
import { getDeviceFrame } from '../../../core/deviceFrames';

import type { CameraSettings, Rect } from '../../../core/types';

export const CanvasContainer = () => {
    const project = useProjectData();
    const canvasMode = useUIStore(s => s.canvasMode);
    const activeZoomId = useUIStore(s => s.selectedZoomId);

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };
    const sources = useProjectSources();
    const isPlaying = useUIStore(s => s.isPlaying);
    const mutedSources = useProjectStore(s => s.mutedSources);

    // DOM Refs for Resources
    const internalVideoRefs = useRef<{ [sourceId: string]: HTMLVideoElement }>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement>(null);
    const deviceFrameRef = useRef<HTMLImageElement>(null);

    // Mutable State for Dragging (60fps preview)
    const previewCameraSettingsRef = useRef<CameraSettings | null>(null);
    const previewZoomRectRef = useRef<Rect | null>(null);

    // Loop State
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);

    // -----------------------------------------------------------
    // RENDER LOOP
    // -----------------------------------------------------------
    useEffect(() => {
        let lastFpsTime = 0;

        const tick = (time: number) => {
            const uiState = useUIStore.getState();
            const { project, sources, userEvents } = useProjectStore.getState();
            const { canvasMode, selectedZoomId: activeZoomId } = uiState;

            // FPS Logging (Optional)
            if (time - lastFpsTime >= 1000) lastFpsTime = time;

            // Only advance time if NOT in a blocking edit mode
            // (Crop and Zoom block playback time updates (implicit in original), Camera does not)
            const isBlockingEdit = canvasMode === CanvasMode.CropEdit || canvasMode === CanvasMode.ZoomEdit;

            if (uiState.isPlaying && !isBlockingEdit) {
                if (lastTimeRef.current === 0) lastTimeRef.current = time;
                const delta = time - lastTimeRef.current;
                const safeDelta = Math.min(delta, 100);

                if (safeDelta > 0) {
                    let nextTime = uiState.currentTimeMs + safeDelta;
                    // Gap Skipping Logic
                    const windows = project.timeline.outputWindows;
                    const activeWindow = windows.find(w => nextTime >= w.startMs && nextTime < w.endMs);
                    if (!activeWindow) {
                        const nextWin = windows.find(w => w.startMs > nextTime);
                        if (nextWin) nextTime = nextWin.startMs;
                        else {
                            uiState.setIsPlaying(false);
                            const lastWin = windows[windows.length - 1];
                            nextTime = lastWin ? lastWin.endMs : 0;
                        }
                    }
                    uiState.setCurrentTime(nextTime);
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
                drawBackground(
                    ctx,
                    project.settings.background,
                    project.settings.background.backgroundBlur,
                    canvas,
                    bgRef.current
                );

                // 2. DETERMINE FRAME TIME
                let effectiveTimeMs = uiState.currentTimeMs;

                // Implement Preview Logic
                if (!uiState.isPlaying && !isBlockingEdit && uiState.previewTimeMs !== null) {
                    effectiveTimeMs = uiState.previewTimeMs;
                }

                // 3. SYNC VIDEO
                const sourceTimeMs = effectiveTimeMs;
                const isPlaying = uiState.isPlaying && !isBlockingEdit;

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
                    videoRefs: internalVideoRefs.current,
                    deviceFrameImg: deviceFrameRef.current
                };

                if (canvasMode === CanvasMode.CropEdit) {
                    renderCropEditor(resources, {
                        project,
                        sources,
                        currentTimeMs: effectiveTimeMs
                    });
                } else if (canvasMode === CanvasMode.ZoomEdit && activeZoomId) {
                    renderZoomEditor(resources, {
                        project,
                        sources,
                        currentTimeMs: effectiveTimeMs,
                        editingZoomId: activeZoomId,
                        previewZoomRect: previewZoomRectRef.current
                    });
                } else {
                    // Preview OR Camera mode (Camera overlays on top, but base is playback)
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
    const activeBgSourceId = project.settings.background.sourceId;
    const bgUrl = activeBgSourceId && sources[activeBgSourceId]
        ? sources[activeBgSourceId].url
        : project.settings.background.imageUrl;

    // Device frame URL for caching
    const deviceFrame = project.settings.screen.mode === 'device'
        ? getDeviceFrame(project.settings.screen.deviceFrameId)
        : undefined;

    // Thumbnail Logic
    useEffect(() => {
        const captureThumbnail = () => {
            // ... existing thumbnail logic
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
                    boxShadow: '0 0 0 1px #333'
                }}
            >
                {/* HIDDEN RESOURCES LAYER */}
                <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
                    {project.settings.background.type === 'image' && bgUrl && (
                        <img ref={bgRef} src={bgUrl} className="hidden" crossOrigin="anonymous" />
                    )}
                    {deviceFrame && (
                        <img ref={deviceFrameRef} src={deviceFrame.imageUrl} className="hidden" crossOrigin="anonymous" />
                    )}
                    {Object.values(sources).map((source) => {
                        const isMuted = !isPlaying || mutedSources[source.id];
                        return source.url ? (
                            <video
                                key={source.id}
                                ref={el => {
                                    if (el) internalVideoRefs.current[source.id] = el;
                                    else delete internalVideoRefs.current[source.id];
                                }}
                                src={source.url}
                                muted={isMuted}
                                playsInline
                                crossOrigin="anonymous"
                            />
                        ) : null;
                    })}
                </div>

                {/* MAIN CANVAS */}
                <canvas
                    ref={canvasRef}
                    className="block w-full h-full object-contain"
                />

                {/* CROP OVERLAY (Highest Priority) */}
                {canvasMode === CanvasMode.CropEdit && (
                    <CropEditor videoSize={(() => {
                        const screenId = project.timeline.recording.screenSourceId;
                        const v = internalVideoRefs.current[screenId];
                        return v ? { width: v.videoWidth, height: v.videoHeight } : undefined;
                    })()} />
                )}

                {/* ZOOM OVERLAY */}
                {canvasMode === CanvasMode.ZoomEdit && activeZoomId && (
                    <ZoomEditor previewRectRef={previewZoomRectRef} />
                )}

                {/* CAMERA OVERLAY */}
                {canvasMode === CanvasMode.CameraEdit && (
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
