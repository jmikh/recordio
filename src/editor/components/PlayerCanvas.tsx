import { useRef, useEffect, useState } from 'react';
import { ProjectStorage } from '../../storage/projectStorage';
import { drawScreen } from '../../core/painters/screenPainter';
import { drawBackground } from '../../core/painters/backgroundPainter';
import { drawWebcam } from '../../core/painters/webcamPainter';
import { drawKeyboardOverlay } from '../../core/painters/keyboardPainter';
import { useProjectStore, useProjectData, useProjectSources } from '../stores/useProjectStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { TimeMapper } from '../../core/timeMapper';
import { getViewportStateAtTime } from '../../core/viewportMotion';
import type { Size, Rect } from '../../core/types';
import { ZoomControl } from './ZoomControl';

export const PlayerCanvas = () => {
    const project = useProjectData();
    const editingZoomId = useProjectStore(s => s.editingZoomId);
    const setEditingZoom = useProjectStore(s => s.setEditingZoom);
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const deleteViewportMotion = useProjectStore(s => s.deleteViewportMotion);

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };
    const sources = useProjectSources();

    const internalVideoRefs = useRef<{ [sourceId: string]: HTMLVideoElement }>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);


    // Background Image Ref
    const bgRef = useRef<HTMLImageElement>(null);

    // Single Effect to manage the Loop for the lifetime of the component
    useEffect(() => {
        let frameCount = 0;
        let lastFpsTime = 0;

        const tick = (time: number) => {
            const pbState = usePlaybackStore.getState();
            const { editingZoomId } = useProjectStore.getState();

            // FPS Counter
            frameCount++;
            if (time - lastFpsTime >= 1000) {
                // console.log(`[PlayerCanvas] tick FPS: ${frameCount}`);
                frameCount = 0;
                lastFpsTime = time;
            }

            // Only advance time if NOT editing
            if (pbState.isPlaying && !editingZoomId) {
                if (lastTimeRef.current === 0) lastTimeRef.current = time;
                const delta = time - lastTimeRef.current;

                // Cap delta to prevent huge jumps (e.g. 100ms)
                const safeDelta = Math.min(delta, 100);

                if (safeDelta > 0) {
                    let nextTime = pbState.currentTimeMs + safeDelta;

                    // GAP SKIPPING LOGIC
                    const project = useProjectStore.getState().project;
                    const windows = project.timeline.outputWindows;

                    const activeWindow = windows.find(w => nextTime >= w.startMs && nextTime < w.endMs);

                    if (!activeWindow) {
                        // We are in a gap or at the end
                        const nextWin = windows.find(w => w.startMs > nextTime);
                        if (nextWin) {
                            // Jump to next window
                            nextTime = nextWin.startMs;
                        } else {
                            // End of timeline
                            pbState.setIsPlaying(false);
                            // Clamp to end
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

            renderPipeline();
            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, []);

    // Render Pipeline
    const renderPipeline = () => {

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const { project, userEvents, sources, editingZoomId } = useProjectStore.getState();
        const playback = usePlaybackStore.getState();

        const currentTimeMs = playback.currentTimeMs;
        const outputSize = project.settings.outputSize;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);


        drawBackground(ctx, project.settings, canvas, bgRef.current);

        const { timeline } = project;
        const { recording, outputWindows } = timeline;

        // 1. Check if ACTIVE (unless editing)
        const activeWindow = outputWindows.find(w => currentTimeMs >= w.startMs && currentTimeMs <= w.endMs);
        if (!activeWindow && !editingZoomId) {
            // Not in output window. 
            // We might want to draw nothing, or just valid background.
            // Returning here means screen/camera layers are skipped.
            return;
        }

        // 2. Calculate Times
        // We still need sourceTimeMs here to sync the video elements
        const sourceTimeMs = currentTimeMs - recording.timelineOffsetMs;

        // 3. Resolve Items
        const screenSource = sources[recording.screenSourceId];
        const cameraSource = recording.cameraSourceId ? sources[recording.cameraSourceId] : undefined;
        // const activeEvents = userEventsCache[recording.screenSourceId]; // Removed

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

        if (editingZoomId) {
            // EDIT MODE: Force Full View (Identity Viewport)
            effectiveViewport = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
        } else {
            // NORMAL MODE: Calculate Viewport from Motions
            const timeMapper = new TimeMapper(recording.timelineOffsetMs, outputWindows);
            const outputTimeMs = timeMapper.mapTimelineToOutputTime(currentTimeMs);
            const viewportMotions = recording.viewportMotions || [];

            effectiveViewport = getViewportStateAtTime(
                viewportMotions,
                outputTimeMs,
                outputSize,
                timeMapper
            );
        }

        // -----------------------------------------------------------

        // Render Screen Layer
        if (screenSource) {
            const video = internalVideoRefs.current[screenSource.id];
            if (video) {
                syncVideo(video, sourceTimeMs / 1000, playback.isPlaying && !editingZoomId);

                drawScreen(
                    ctx,
                    video,
                    project,
                    sources,
                    // If editing, hide mouse effects (pass null)
                    editingZoomId ? null : userEvents,
                    currentTimeMs,
                    effectiveViewport
                );
            } else {
                // If video not ready, maybe draw black rect?
            }
        }

        // Render Webcam Layer - HIDE IF EDITING
        if (cameraSource && !editingZoomId) {
            const video = internalVideoRefs.current[cameraSource.id];
            if (video) {
                // Camera syncs to same time as screen source
                syncVideo(video, sourceTimeMs / 1000, playback.isPlaying);
                drawWebcam(ctx, video, outputSize, cameraSource.size);
            }
        }

        // Render Keyboard Overlay - HIDE IF EDITING
        if (userEvents && userEvents.keyboardEvents && !editingZoomId) {

            drawKeyboardOverlay(
                ctx,
                userEvents.keyboardEvents,
                sourceTimeMs,
                outputSize
            );
        }
    };

    const syncVideo = (video: HTMLVideoElement, desiredTimeS: number, isPlaying: boolean) => {
        if (isPlaying) {
            if (video.paused) video.play().catch(() => { });
            if (Math.abs(video.currentTime - desiredTimeS) > 0.2) video.currentTime = desiredTimeS;
        } else {
            if (!video.paused) video.pause();
            if (Math.abs(video.currentTime - desiredTimeS) > 0.001) video.currentTime = desiredTimeS;
        }
    };

    // Canvas Sizing
    useEffect(() => {
        if (canvasRef.current && outputVideoSize) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;
            renderPipeline();
        }
    }, [outputVideoSize.width, outputVideoSize.height]);

    // Thumbnail Auto-Capture
    // Saves a low-res screen capture to DB for the project list
    useEffect(() => {
        const captureThumbnail = () => {
            const canvas = canvasRef.current;
            if (!canvas || !project || !project.id) return;

            // Only capture if content (simple check: if we have active window or just always?)
            // We want the current view.

            canvas.toBlob((blob) => {
                if (blob) {
                    ProjectStorage.saveThumbnail(project.id, blob).catch(err => {
                        console.warn('Failed to save thumbnail', err);
                    });
                }
            }, 'image/jpeg', 0.5); // Low quality
        };

        // Capture initially after a short delay to ensure render
        const initialTimer = setTimeout(captureThumbnail, 3000);

        // Capture periodically (very slow, e.g. every minute or when paused?)
        // Let's do it when pausing? Or just interval.
        const interval = setInterval(captureThumbnail, 60000);

        return () => {
            clearTimeout(initialTimer);
            clearInterval(interval);
        };
    }, [project?.id]); // Re-run if project changes

    // active background logic
    const activeBgSourceId = project.settings.backgroundSourceId;
    const bgUrl = activeBgSourceId && sources[activeBgSourceId]
        ? sources[activeBgSourceId].url
        : project.settings.backgroundImageUrl;


    // -----------------------------------------------------------
    // LAYOUT & METRICS (ASPECT RATIO FIT)
    // -----------------------------------------------------------
    const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setContainerSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                });
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    // Calculate the "Visual" rect of the video within the container (simulating object-fit: contain)
    const getFittedRect = (): Rect => {
        if (containerSize.width === 0 || containerSize.height === 0) return { x: 0, y: 0, width: 0, height: 0 };

        const videoRatio = outputVideoSize.width / outputVideoSize.height;
        const containerRatio = containerSize.width / containerSize.height;

        let width, height, x, y;

        if (containerRatio > videoRatio) {
            // Container is wider -> Pillarbox (fit height)
            height = containerSize.height;
            width = height * videoRatio;
            y = 0;
            x = (containerSize.width - width) / 2;
        } else {
            // Container is taller -> Letterbox (fit width)
            width = containerSize.width;
            height = width / videoRatio;
            x = 0;
            y = (containerSize.height - height) / 2;
        }

        return { x, y, width, height };
    };

    const fittedRect = getFittedRect();


    // -----------------------------------------------------------
    // EDIT INTERACTION HANDLERS
    // -----------------------------------------------------------
    const activeMotion = editingZoomId
        ? project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId)
        : null;

    // Debug / Safety: Auto-exit if motion not found
    useEffect(() => {
        if (editingZoomId && !activeMotion) {
            console.warn('[PlayerCanvas] Editing ID set but motion not found. Exiting.');
            setEditingZoom(null);
        }
    }, [editingZoomId, activeMotion, setEditingZoom]);

    return (
        <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
            {/* INVISIBLE MEDIA LOADING LAYER */}
            <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
                {project.settings.backgroundType === 'image' && bgUrl && (
                    <img
                        ref={bgRef}
                        src={bgUrl}
                        className="hidden" // Just for loading
                        onLoad={() => {
                            // Trigger re-render
                            // Force update? Or assume canvas loop picks it up?
                            // Canvas loop picks it up on next 'tick' if image is complete
                        }}
                    />
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
                            muted={false}
                            playsInline
                            crossOrigin="anonymous"
                        />
                    ) : null
                ))}
            </div>

            <canvas
                ref={canvasRef}
                className="block"
                style={{
                    // Canvas should physically match the Fitted Rect to ensure 1:1 pixel mapping if possible,
                    // OR just use object-fit: contain on the canvas element itself (as before).
                    // But to align overlay, we are calculating fittedRect manually.
                    // Let's stick to the previous 'CSS fitting' for the canvas to avoid pixelation issues on resize?
                    // actually, we simply want the canvas to fill the fitted rect?
                    // No, existing logic was w-full h-full object-fit contain.
                    // If we use w-full h-full, the canvas fills the container.
                    // Let's keep canvas w-full h-full object-fit-contain for simplicity of rendering pipeline
                    // (which expects to draw to 1920x1080 buffer).
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                }}
            />

            {/* EDIT OVERLAY */}
            {editingZoomId && activeMotion && (
                <ZoomControl
                    initialRect={activeMotion.rect}
                    videoSize={outputVideoSize}
                    containerFittedRect={fittedRect}
                    onCommit={(rect) => updateViewportMotion(editingZoomId, { rect })}
                    onCancel={() => setEditingZoom(null)}
                    onDelete={() => deleteViewportMotion(editingZoomId)}
                />
            )}
        </div>
    );
};

PlayerCanvas.displayName = 'PlayerCanvas';
