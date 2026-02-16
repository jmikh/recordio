import { useRef, useEffect, useMemo } from 'react';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ProjectStorage } from '../../../storage/projectStorage';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { useBackgroundMusic } from '../../hooks/useBackgroundMusic';

import { PlaybackRenderer, type RenderResources } from './PlaybackRenderer';
import { resetClickSounds } from '../../../core/audio/clickSoundPlayer';
import { ZoomEditor, renderZoomEditor } from './ZoomEditor';
import { SpotlightEditor, renderSpotlightEditor } from './SpotlightEditor';
import { renderCropEditor, CropEditor } from './CropEditor';
import { CameraEditor } from './CameraEditor';
import { drawBackground } from '../../../core/painters/backgroundPainter';
import { getDeviceFrame } from '../../../core/deviceFrames';

import type { CameraSettings, Rect, SourceMetadata } from '../../../types';

export const CanvasContainer = () => {
    //console.log('[Rerender] CanvasContainer');
    const project = useProjectData();
    const canvasMode = useUIStore(s => s.canvasMode);
    const activeZoomId = useUIStore(s => s.selectedZoomId);
    const activeSpotlightId = useUIStore(s => s.selectedSpotlightId);

    // Background music sync with playback
    useBackgroundMusic();

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };

    // Build sources array from project - now embedded directly
    const sources = useMemo(() => {
        const result: Record<string, SourceMetadata> = {};
        if (project.screenSource.id) {
            result[project.screenSource.id] = project.screenSource;
        }
        if (project.cameraSource?.id) {
            result[project.cameraSource.id] = project.cameraSource;
        }
        return result;
    }, [project.screenSource, project.cameraSource]);

    const isPlaying = useUIStore(s => s.isPlaying);
    const mutedSources = useProjectStore(s => s.mutedSources);

    // TimeMapper
    const timeMapper = useTimeMapper();
    const timeMapperRef = useRef(timeMapper);
    timeMapperRef.current = timeMapper;

    // FocusAreas (for debug painter) - now read from project.timeline
    const focusAreas = project?.timeline?.focusAreas || [];
    const focusAreasRef = useRef(focusAreas);
    focusAreasRef.current = focusAreas;

    // DOM Refs for Resources
    const internalVideoRefs = useRef<{ [sourceId: string]: HTMLVideoElement }>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement>(null);
    const deviceFrameRef = useRef<HTMLImageElement>(null);

    // Mutable State for Dragging (60fps preview)
    const previewCameraSettingsRef = useRef<CameraSettings | null>(null);
    const previewZoomRectRef = useRef<Rect | null>(null);
    const previewSpotlightRectRef = useRef<Rect | null>(null);
    const aspectWrapperRef = useRef<HTMLDivElement | null>(null);

    // Update canvas container size in UI store for DisplayMapper
    const setCanvasContainerSize = useUIStore(s => s.setCanvasContainerSize);

    // Loop State
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);

    // Measure container size and update store
    useEffect(() => {
        const wrapper = aspectWrapperRef.current;
        if (!wrapper) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setCanvasContainerSize({ width, height });
                }
            }
        });

        observer.observe(wrapper);
        return () => observer.disconnect();
    }, [setCanvasContainerSize]);

    // -----------------------------------------------------------
    // RENDER LOOP
    // -----------------------------------------------------------
    // -----------------------------------------------------------
    useEffect(() => {
        // Toggle to `true` to enable per-frame performance profiling
        const ENABLE_FPS_PROFILER = false;
        let fpsFrameCount = 0;
        let fpsLastTime = performance.now();
        let perfAccum: Record<string, number> = {};

        const perf = (label: string, fn: () => void) => {
            if (ENABLE_FPS_PROFILER) {
                const s = performance.now();
                fn();
                perfAccum[label] = (perfAccum[label] || 0) + (performance.now() - s);
            } else {
                fn();
            }
        };

        const tick = (time: number) => {
            animationFrameRef.current = requestAnimationFrame(tick);

            // FPS + per-operation profiler
            if (ENABLE_FPS_PROFILER) {
                fpsFrameCount++;
                const now = performance.now();
                if (now - fpsLastTime >= 1000) {
                    const breakdown = Object.entries(perfAccum)
                        .map(([k, v]) => `${k}=${(v / fpsFrameCount).toFixed(1)}ms`)
                        .join(' | ');
                    console.log(`[Canvas FPS] ${fpsFrameCount}  ${breakdown}`);
                    fpsFrameCount = 0;
                    fpsLastTime = now;
                    perfAccum = {};
                }
            }

            // Skip expensive rendering while export is in progress.
            // The export uses its own offscreen canvas and video elements,
            // so the main canvas render loop just wastes CPU/GPU cycles.
            // Playback is paused via UIStore at export start (Header.tsx).
            const { exportState } = useProjectStore.getState();
            if (exportState.isExporting) return;

            const uiState = useUIStore.getState();
            const { project } = useProjectStore.getState();
            const { canvasMode, selectedZoomId: activeZoomId, selectedSpotlightId: activeSpotlightId } = uiState;

            // Build sources from project
            const sources: Record<string, SourceMetadata> = {};
            if (project.screenSource.id) {
                sources[project.screenSource.id] = project.screenSource;
            }
            if (project.cameraSource?.id) {
                sources[project.cameraSource.id] = project.cameraSource;
            }

            if (uiState.isPlaying) {
                if (lastTimeRef.current === 0) lastTimeRef.current = time;
                const delta = time - lastTimeRef.current;
                const safeDelta = Math.min(delta, 100);

                if (safeDelta > 0) {
                    let nextTime = uiState.currentTimeMs + safeDelta;
                    // Use the latest timeMapper from the ref (synced with React state)
                    const outputDuration = timeMapperRef.current.outputDuration;

                    if (nextTime >= outputDuration) {
                        nextTime = outputDuration;
                        uiState.setIsPlaying(false);
                    }
                    uiState.setCurrentTime(nextTime);
                }
                lastTimeRef.current = time;
            } else {
                lastTimeRef.current = 0;
                resetClickSounds();
            }

            // PERFORM RENDER
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');

            if (canvas && ctx) {
                // 1. CLEAR & BACKGROUND
                perf('bg', () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    drawBackground(
                        ctx,
                        project.settings.background,
                        project.settings.background.backgroundBlurPx,
                        canvas,
                        bgRef.current
                    );
                });

                // 2. DETERMINE FRAME TIME
                let effectiveTimeMs = uiState.currentTimeMs;

                // Implement Preview Logic
                if (!uiState.isPlaying && uiState.previewTimeMs !== null) {
                    effectiveTimeMs = uiState.previewTimeMs;
                }

                // 3. SYNC VIDEO
                perf('videoSync', () => {
                    const sourceTimeMs = timeMapperRef.current.mapOutputToSourceTime(effectiveTimeMs);
                    const windowInfo = timeMapperRef.current.getWindowAtOutputTime(effectiveTimeMs);
                    const playbackSpeed = windowInfo?.window.speed || 1.0;

                    Object.values(sources).forEach(source => {
                        const video = internalVideoRefs.current[source.id];
                        if (video) {
                            if (sourceTimeMs === -1) {
                                if (!video.paused) video.pause();
                                video.playbackRate = 1.0;
                            } else {
                                if (video.playbackRate !== playbackSpeed) {
                                    video.playbackRate = playbackSpeed;
                                }
                                syncVideo(video, sourceTimeMs / 1000, uiState.isPlaying);
                            }
                        }
                    });
                });

                // 4. STRATEGY
                const resources: RenderResources = {
                    canvas,
                    ctx,
                    bgRef: bgRef.current,
                    videoRefs: internalVideoRefs.current,
                    deviceFrameImg: deviceFrameRef.current
                };

                perf('render', () => {
                    if (canvasMode === CanvasMode.CropEdit) {
                        renderCropEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs
                        });
                    } else if (canvasMode === CanvasMode.ZoomEdit && activeZoomId) {
                        renderZoomEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            editingZoomId: activeZoomId,
                            previewZoomRect: previewZoomRectRef.current
                        });
                    } else if (canvasMode === CanvasMode.SpotlightEdit && activeSpotlightId) {
                        renderSpotlightEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            editingSpotlightId: activeSpotlightId,
                            previewSpotlightRect: previewSpotlightRectRef.current
                        });
                    } else {
                        PlaybackRenderer.render(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            timeMapper: timeMapperRef.current,
                            overrideCameraSettings: previewCameraSettingsRef.current || undefined,
                            isCameraEditing: canvasMode === CanvasMode.CameraEdit,
                            focusAreas: focusAreasRef.current,
                            showDebugOverlays: uiState.showDebugOverlays
                        });
                    }
                });

                // Thumbnail capture (after rendering is complete)
                if (pendingThumbnailCaptureRef.current) {
                    pendingThumbnailCaptureRef.current = false;
                    canvas.toBlob((blob) => {
                        if (blob) ProjectStorage.saveThumbnail(project.id, blob).catch(console.warn);
                    }, 'image/jpeg', 0.5);
                    // Schedule next capture in 60s
                    scheduleThumbnailCapture(60000);
                }
            };
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
    // For backgrounds: prefer customRuntimeUrl (uploaded), fallback to imageUrl (preset)
    const bgUrl = project.settings.background.customRuntimeUrl || project.settings.background.imageUrl;

    // Device frame URL for caching
    const deviceFrame = project.settings.screen.mode === 'device'
        ? getDeviceFrame(project.settings.screen.deviceFrameId)
        : undefined;

    // Thumbnail Capture Flag (set by timer, captured at end of render loop)
    const pendingThumbnailCaptureRef = useRef(false);
    const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleThumbnailCapture = (delayMs: number) => {
        if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
        thumbnailTimerRef.current = setTimeout(() => {
            pendingThumbnailCaptureRef.current = true;
        }, delayMs);
    };

    // Start thumbnail capture schedule
    useEffect(() => {
        scheduleThumbnailCapture(3000); // Initial capture after 3s
        return () => {
            if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
        };
    }, [project?.id]);

    // -----------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------

    // Check if we're in an editor mode that needs the glow
    const isEditorMode = canvasMode === CanvasMode.ZoomEdit ||
        canvasMode === CanvasMode.CropEdit ||
        canvasMode === CanvasMode.SpotlightEdit ||
        canvasMode === CanvasMode.CameraEdit;

    return (
        <div className={`relative w-full h-full bg-surface flex items-center justify-center p-2`}>

            {/* ASPECT RATIO WRAPPER */}
            <div
                ref={aspectWrapperRef}
                className={`relative ${isEditorMode ? 'canvas-editor-glow' : ''}`}
                style={{
                    aspectRatio: `${outputVideoSize.width} / ${outputVideoSize.height}`,
                    maxHeight: '100%',
                    maxWidth: '100%',
                    boxShadow: !isEditorMode ? '0 0 0 2px var(--primary)' : undefined
                }}
            >
                {/* HIDDEN RESOURCES LAYER */}
                <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
                    {(project.settings.background.type === 'preset' || project.settings.background.type === 'custom') && bgUrl && (
                        <img ref={bgRef} src={bgUrl} className="hidden" crossOrigin={bgUrl.startsWith('blob:') ? undefined : 'anonymous'} />
                    )}
                    {deviceFrame && (
                        <img ref={deviceFrameRef} src={deviceFrame.imageUrl} className="hidden" crossOrigin={deviceFrame.imageUrl.startsWith('blob:') ? undefined : 'anonymous'} />
                    )}
                    {Object.values(sources).map((source) => {
                        const audioSettings = project.settings.audio;
                        const isScreenSource = source.id === project.screenSource?.id;
                        const isCameraSource = source.id === project.cameraSource?.id;
                        const settingsMuted = (isScreenSource && audioSettings?.muteScreenAudio)
                            || (isCameraSource && audioSettings?.muteMicrophone);
                        const isMuted = !isPlaying || mutedSources[source.id] || !!settingsMuted;
                        const volume = isScreenSource
                            ? (audioSettings?.screenVolume ?? 1)
                            : isCameraSource
                                ? (audioSettings?.microphoneVolume ?? 1)
                                : 1;
                        return source.runtimeUrl ? (
                            <video
                                key={source.id}
                                ref={el => {
                                    if (el) {
                                        internalVideoRefs.current[source.id] = el;
                                        el.volume = volume;
                                    } else {
                                        delete internalVideoRefs.current[source.id];
                                    }
                                }}
                                src={source.runtimeUrl}
                                muted={isMuted}
                                playsInline
                                onError={(e) => {
                                    const video = e.currentTarget;
                                    const err = video.error;
                                    console.error('[CanvasContainer] Video error:',
                                        'sourceId=', source.id,
                                        'code=', err?.code,
                                        'message=', err?.message,
                                        'currentTime=', video.currentTime,
                                        'duration=', video.duration,
                                        'readyState=', video.readyState,
                                        'networkState=', video.networkState
                                    );
                                }}
                                onStalled={() => {
                                    const video = internalVideoRefs.current[source.id];
                                    console.warn('[CanvasContainer] Video stalled:', {
                                        sourceId: source.id,
                                        currentTime: video?.currentTime,
                                        buffered: video?.buffered.length ?
                                            `${video.buffered.start(0)}-${video.buffered.end(video.buffered.length - 1)}` : 'none',
                                    });
                                }}
                                onWaiting={() => {
                                    console.log('[CanvasContainer] Video waiting for data:', source.id);
                                }}
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
                        const screenId = project.screenSource.id;
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

                {/* SPOTLIGHT OVERLAY */}
                {canvasMode === CanvasMode.SpotlightEdit && activeSpotlightId && (
                    <SpotlightEditor previewRectRef={previewSpotlightRectRef} />
                )}
            </div>
        </div>
    );
};

// Helper
const syncVideo = (video: HTMLVideoElement, desiredTimeS: number, isPlaying: boolean) => {
    if (isPlaying) {
        if (video.paused) video.play().catch(() => { });
        if (Math.abs(video.currentTime - desiredTimeS) > 0.4) {
            video.currentTime = desiredTimeS;
        }
    } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - desiredTimeS) > 0.2) video.currentTime = desiredTimeS;
    }
};
