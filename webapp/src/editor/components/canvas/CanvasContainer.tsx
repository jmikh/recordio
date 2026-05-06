import { useRef, useEffect, useMemo } from 'react';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useMediaUrlStore } from '../../stores/useMediaUrlStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { useBackgroundMusic } from '../../hooks/useBackgroundMusic';

import { PlaybackRenderer, type RenderResources } from '@shared/export/PlaybackRenderer';
import { playClickSounds, playDragSounds, resetClickSounds } from '../../../core/audio/clickSoundPlayer';
import { browserRenderContext } from '../../../core/renderContext';
import { ZoomEditor, renderZoomEditor } from './CanvasZoomEditor';
import { SpotlightEditor, renderSpotlightEditor } from './CanvasSpotlightEditor';
import { renderCropEditor, CropEditor } from './CanvasCropEditor';
import { CameraEditor, renderCameraEditor } from './CanvasCameraEditor';
import { CameraMoveEditor, renderCameraMoveEditor } from './CanvasCameraMoveEditor';
import { OverlayEditor, renderOverlayEditor } from './CanvasOverlayEditor';
import { CanvasHoverLayer } from './CanvasHoverLayer';
import { drawBackground } from '@shared/painters/backgroundPainter';

import { getDeviceFrame } from '@shared/utils/deviceFrames';


import type { BackgroundSettings, CameraSettings, Rect, SourceMetadata } from '@shared/types';
import type { OverlayItem } from '@shared/types/overlay';

export const CanvasContainer = () => {
    const project = useProjectData();
    const canvasMode = useUIStore(s => s.canvasMode);
    const activeZoomId = useUIStore(s => s.selectedZoomId);
    const activeSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const activeCameraMoveId = useUIStore(s => s.selectedCameraMoveId);
    const activeOverlayBlockId = useUIStore(s => s.selectedOverlaySegmentId);

    // Background music sync with playback
    useBackgroundMusic();

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };

    // Build sources array from project - now embedded directly
    const sources = useMemo(() => {
        const result: Record<string, SourceMetadata> = {};
        if (project.screenSource.storagePath) {
            result[project.screenSource.storagePath] = project.screenSource;
        }
        if (project.cameraSource?.storagePath) {
            result[project.cameraSource.storagePath] = project.cameraSource;
        }
        return result;
    }, [project.screenSource, project.cameraSource]);

    const isPlaying = useUIStore(s => s.isPlaying);
    const mutedSources = useProjectStore(s => s.mutedSources);
    const mediaUrls = useMediaUrlStore(s => s.urls);

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
    const micAudioRef = useRef<HTMLAudioElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement>(null);
    const deviceFrameRef = useRef<HTMLImageElement>(null);


    // Mutable State for Dragging (60fps preview)
    const previewCameraSettingsRef = useRef<CameraSettings | null>(null);
    const previewZoomRectRef = useRef<Rect | null>(null);
    const previewSpotlightRectRef = useRef<Rect | null>(null);
    const previewOverlayItemRef = useRef<OverlayItem | null>(null);
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
            const { canvasMode, selectedZoomId: activeZoomId, selectedSpotlightId: activeSpotlightId, selectedCameraMoveId: activeCameraMoveId, selectedOverlaySegmentId: activeOverlayBlockId } = uiState;

            // Build sources from project
            const sources: Record<string, SourceMetadata> = {};
            if (project.screenSource.storagePath) {
                sources[project.screenSource.storagePath] = project.screenSource;
            }
            if (project.cameraSource?.storagePath) {
                sources[project.cameraSource.storagePath] = project.cameraSource;
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
                        { width: canvas.width, height: canvas.height },
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
                        const video = internalVideoRefs.current[source.storagePath];
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

                    // Sync mic audio element (same timing as video sources)
                    const micAudio = micAudioRef.current;
                    if (micAudio) {
                        if (sourceTimeMs === -1) {
                            if (!micAudio.paused) micAudio.pause();
                            micAudio.playbackRate = 1.0;
                        } else {
                            if (micAudio.playbackRate !== playbackSpeed) {
                                micAudio.playbackRate = playbackSpeed;
                            }
                            syncVideo(micAudio, sourceTimeMs / 1000, uiState.isPlaying);
                        }
                    }
                });

                // 4. STRATEGY
                const resources: RenderResources = {
                    ctx,
                    renderCtx: browserRenderContext,
                    bgRef: bgRef.current,
                    videoRefs: internalVideoRefs.current,
                    deviceFrameImg: deviceFrameRef.current,
                    sourceCanvas: canvas
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
                    } else if (canvasMode === CanvasMode.CameraEdit) {
                        renderCameraEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            overrideCameraSettings: previewCameraSettingsRef.current
                        });
                    } else if (canvasMode === CanvasMode.CameraMoveEdit && activeCameraMoveId) {
                        renderCameraMoveEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            overrideCameraSettings: previewCameraSettingsRef.current
                        });
                    } else if (canvasMode === CanvasMode.OverlayEdit && activeOverlayBlockId) {
                        // Find the selected segment's item id for editingItemId
                        const overlayBlock = project.timeline.overlaySegments?.find((b: any) => b.id === activeOverlayBlockId);
                        renderOverlayEditor(resources, {
                            project,
                            currentTimeMs: effectiveTimeMs,
                            editingItemId: overlayBlock?.item?.id ?? null,
                            overrideOverlayItem: previewOverlayItemRef.current,
                        });
                    } else {
                        const userEvents = useProjectStore.getState().userEvents;
                        PlaybackRenderer.render(resources, {
                            project,
                            projectName: useProjectStore.getState().projectName,
                            userEvents,
                            currentTimeMs: effectiveTimeMs,
                            timeMapper: timeMapperRef.current,
                            overrideCameraSettings: previewCameraSettingsRef.current || undefined,
                            focusAreas: focusAreasRef.current,
                            showDebugOverlays: uiState.showDebugOverlays
                        });

                        // Audio side-effects (browser-only, not part of rendering pipeline)
                        const mouse = project.settings.mouse;
                        if (mouse?.soundEnabled) {
                            playClickSounds(userEvents.mouseClicks, effectiveTimeMs, mouse.soundVolume ?? 0.5, timeMapperRef.current);
                            playDragSounds(userEvents.drags, effectiveTimeMs, mouse.soundVolume ?? 0.5, timeMapperRef.current);
                        }
                    }
                });

                // Thumbnail capture — only in playback mode, scaled to 480px webp
                if (pendingThumbnailCaptureRef.current && canvasMode === CanvasMode.Preview) {
                    pendingThumbnailCaptureRef.current = false;
                    lastCapturedBgRef.current = { ...project.settings.background };
                    const thumbMaxW = 480;
                    const scale = Math.min(thumbMaxW / canvas.width, 1);
                    const thumbW = Math.round(canvas.width * scale);
                    const thumbH = Math.round(canvas.height * scale);
                    const offscreen = document.createElement('canvas');
                    offscreen.width = thumbW;
                    offscreen.height = thumbH;
                    offscreen.getContext('2d')!.drawImage(canvas, 0, 0, thumbW, thumbH);
                    offscreen.toBlob((blob) => {
                        if (blob) CloudProjectService.saveThumbnail(project.id, blob).catch(console.warn);
                    }, 'image/webp', 0.8);
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
    // For backgrounds: prefer blob URL from mediaUrls (custom upload), fallback to imageUrl (preset)
    const bgStoragePath = project.settings.background.storagePath;
    const bgUrl = (bgStoragePath && mediaUrls[bgStoragePath]) || project.settings.background.imageUrl;

    // Device frame URL for caching
    const deviceFrame = project.settings.screen.mode === 'device'
        ? getDeviceFrame(project.settings.screen.deviceFrameId)
        : undefined;

    // Thumbnail capture — only when background changes or no thumbnail exists
    const pendingThumbnailCaptureRef = useRef(false);
    const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCapturedBgRef = useRef<BackgroundSettings | null>(null);

    const scheduleThumbnailCapture = (delayMs: number) => {
        if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
        thumbnailTimerRef.current = setTimeout(() => {
            pendingThumbnailCaptureRef.current = true;
        }, delayMs);
    };

    // On project load: always schedule a thumbnail capture
    useEffect(() => {
        if (!project?.id) return;
        lastCapturedBgRef.current = null;
        scheduleThumbnailCapture(1500);
        return () => {
            if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
        };
    }, [project?.id]);

    // Debounced capture when background settings change
    const bg = project.settings.background;
    useEffect(() => {
        // Skip if we haven't captured yet (initial capture handles that)
        if (!lastCapturedBgRef.current) return;
        scheduleThumbnailCapture(2000);
    }, [bg.type, bg.color, bg.colorMode, bg.gradientColors, bg.gradientDirection, bg.imageUrl, bg.storagePath, bg.backgroundBlurPx]);

    // -----------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------

    // Check if we're in an editor mode that needs the glow
    const isEditorMode = canvasMode === CanvasMode.ZoomEdit ||
        canvasMode === CanvasMode.CropEdit ||
        canvasMode === CanvasMode.SpotlightEdit ||
        canvasMode === CanvasMode.CameraEdit ||
        canvasMode === CanvasMode.CameraMoveEdit ||
        canvasMode === CanvasMode.OverlayEdit;

    return (
        <div id="canvas-container" className={`relative w-full h-full flex items-center justify-center p-2`}>

            {/* ASPECT RATIO WRAPPER */}
            <div
                id="canvas-aspect-wrapper"
                ref={aspectWrapperRef}
                className={`relative ${isEditorMode ? 'canvas-editor-glow' : ''}`}
                style={{
                    aspectRatio: `${outputVideoSize.width} / ${outputVideoSize.height}`,
                    maxHeight: '100%',
                    maxWidth: '100%',
                    boxShadow: !isEditorMode ? '0 0 0 1px var(--text-disabled)' : undefined
                }}
            >
                {/* HIDDEN RESOURCES LAYER */}
                <div id="canvas-hidden-resources" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
                    {(project.settings.background.type === 'preset' || project.settings.background.type === 'custom') && bgUrl && (
                        <img ref={bgRef} src={bgUrl} className="hidden" crossOrigin={bgUrl.startsWith('blob:') ? undefined : 'anonymous'} />
                    )}
                    {deviceFrame && (
                        <img ref={deviceFrameRef} src={deviceFrame.imageUrl} className="hidden" crossOrigin={deviceFrame.imageUrl.startsWith('blob:') ? undefined : 'anonymous'} />
                    )}

                    {Object.values(sources).map((source) => {
                        const audioSettings = project.settings.audio;
                        const isScreenSource = source.storagePath === project.screenSource?.storagePath;
                        const settingsMuted = isScreenSource && audioSettings?.muteScreenAudio;
                        const isMuted = !isPlaying || mutedSources[source.storagePath] || !!settingsMuted;
                        const volume = isScreenSource
                            ? (audioSettings?.screenVolume ?? 1)
                            : 1;
                        const sourceUrl = mediaUrls[source.storagePath];
                        return sourceUrl ? (
                            <video
                                key={source.storagePath}
                                ref={el => {
                                    if (el) {
                                        internalVideoRefs.current[source.storagePath] = el;
                                        el.volume = volume;
                                    } else {
                                        delete internalVideoRefs.current[source.storagePath];
                                    }
                                }}
                                src={sourceUrl}
                                muted={isMuted}
                                playsInline
                                onError={(e) => {
                                    const video = e.currentTarget;
                                    const err = video.error;
                                    console.error('[CanvasContainer] Video error:',
                                        'sourceId=', source.storagePath,
                                        'code=', err?.code,
                                        'message=', err?.message,
                                        'currentTime=', video.currentTime,
                                        'duration=', video.duration,
                                        'readyState=', video.readyState,
                                        'networkState=', video.networkState
                                    );
                                }}
                                onStalled={() => {
                                    const video = internalVideoRefs.current[source.storagePath];
                                    console.warn('[CanvasContainer] Video stalled:', {
                                        sourceId: source.storagePath,
                                        currentTime: video?.currentTime,
                                        buffered: video?.buffered.length ?
                                            `${video.buffered.start(0)}-${video.buffered.end(video.buffered.length - 1)}` : 'none',
                                    });
                                }}
                                onWaiting={() => {
                                    // Video waiting for data
                                }}
                            />
                        ) : null;
                    })}
                    {/* Mic audio element (separate track, no video) */}
                    {project.microphoneSource && mediaUrls[project.microphoneSource.storagePath] && (
                        <audio
                            ref={el => {
                                micAudioRef.current = el;
                                if (el) {
                                    el.volume = project.settings.audio?.microphoneVolume ?? 1;
                                }
                            }}
                            src={mediaUrls[project.microphoneSource.storagePath]}
                            muted={!isPlaying || !!project.settings.audio?.muteMicrophone}
                            preload="auto"
                            onError={(e) => {
                                console.error('[CanvasContainer] Mic audio error:', e);
                            }}
                        />
                    )}
                </div>

                {/* MAIN CANVAS */}
                <canvas
                    id="main-canvas"
                    ref={canvasRef}
                    className="block w-full h-full object-contain"
                />

                {/* Canvas hover targets (camera first, then overlays) */}
                <CanvasHoverLayer />

                {/* CROP OVERLAY (Highest Priority) */}
                {canvasMode === CanvasMode.CropEdit && (
                    <CropEditor videoSize={(() => {
                        const screenId = project.screenSource.storagePath;
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

                {/* CAMERA LAYOUT OVERLAY */}
                {canvasMode === CanvasMode.CameraMoveEdit && activeCameraMoveId && (
                    <CameraMoveEditor cameraRef={previewCameraSettingsRef} />
                )}

                {/* OVERLAY EDITOR */}
                {canvasMode === CanvasMode.OverlayEdit && activeOverlayBlockId && (
                    <OverlayEditor previewItemRef={previewOverlayItemRef} />
                )}
            </div>
        </div>
    );
};

// Helper
const syncVideo = (media: HTMLMediaElement, desiredTimeS: number, isPlaying: boolean) => {
    if (isPlaying) {
        if (media.paused) media.play().catch(() => { });
        if (Math.abs(media.currentTime - desiredTimeS) > 0.4) {
            media.currentTime = desiredTimeS;
        }
    } else {
        if (!media.paused) media.pause();
        if (Math.abs(media.currentTime - desiredTimeS) > 0.2) media.currentTime = desiredTimeS;
    }
};
