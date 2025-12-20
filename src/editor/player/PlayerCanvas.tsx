import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditorStore } from '../store';
import { ViewTransform } from '../../core/effects/viewTransform';
import { getCameraStateAtTime } from '../../core/effects/cameraMotion';
import { drawMouseEffects } from './mousePainter';
import { useProject } from '../../hooks/useProject';
import { ProjectImpl } from '../../core/project/project';

interface PlayerCanvasProps {
    src: string;
    onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    className?: string;
    muted?: boolean;
    debugCameraMode?: 'active' | 'visualize';
}

export const PlayerCanvas = forwardRef<HTMLVideoElement, PlayerCanvasProps>(({
    src,
    onLoadedMetadata,
    muted = true,
    debugCameraMode = 'active'
}, ref) => {
    // We need some store values for sizing, but schedule comes from hook
    const { paddingPercentage } = useEditorStore();
    const { project, currentTimeMs } = useProject();

    // Derived State from Project (for React Render Cycle)
    const outputVideoSize = project.outputSettings.size;
    const inputVideoSize = (() => {
        // TODO: Do not rely on source[0], find the correct active source or main source.
        const source = Object.values(project.sources)[0];
        if (!source?.size) {
            console.error('[PlayerCanvas] project.sources[0].size is missing!', source);
            return { width: 1920, height: 1080 };
        }
        return source.size;
    })();

    // Resolve what to show
    let renderState;
    try {
        renderState = ProjectImpl.getRenderState(project, currentTimeMs);
    } catch (e) {
        console.error('[PlayerCanvas] Error getting render state:', e);
        // Fallback to empty state
        renderState = { timeMs: currentTimeMs, tracks: [] };
    }

    // For now, let's assume Track 1 is the "Video" track we want to show.
    // In reality, we might mix multiple tracks.
    // Let's find the first track with a valid clip.
    const activeTrackItem = renderState.tracks.find(t => t.clip);
    const activeClip = activeTrackItem?.clip;

    // DEBUG LOGS (State updates)
    useEffect(() => {
        if (!activeClip && project.sources && Object.keys(project.sources).length > 0) {
            // Warn if no active clip but we have sources (potential issue)
            // console.warn('[PlayerCanvas] No active clip at time:', currentTimeMs);
        }
    }, [currentTimeMs, activeClip, project.sources]);

    const internalVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>(0);

    // Expose the internal video element to the parent
    useImperativeHandle(ref, () => internalVideoRef.current as HTMLVideoElement);

    useEffect(() => {
        console.log('[PlayerCanvas] Mounted. Src:', src);
    }, [src]);

    // Metadata handler wrapper
    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (onLoadedMetadata) {
            onLoadedMetadata(e);
        }
        // Initialize canvas size once metadata is loaded
        if (canvasRef.current && outputVideoSize) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;

            // Force draw initial frame
            const video = e.currentTarget;
            drawVideo(video, canvasRef.current);
        }
        startRenderLoop();
    };

    // ------------------------------------------------------------------------
    // RENDER LOOP ARCHITECTURE
    // ------------------------------------------------------------------------
    // To ensure 60fps performance and avoid React render-cycle lag, we use
    // an imperative render loop via requestAnimationFrame.
    //
    // CRITICAL: We fetch the latest state directly from the zustand stores
    // (useProject.getState()) inside the loop. This avoids "stale closure"
    // issues where the loop would otherwise be stuck using the state
    // captured at component mount.
    // ------------------------------------------------------------------------

    const drawVideo = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. Fetch Fresh State (Bypass React Closures)
        const projectState = useProject.getState();
        const project = projectState.project;
        const currentTimeMs = projectState.currentTimeMs;
        const { paddingPercentage } = useEditorStore.getState();

        // Derive needed sizes from fresh project state
        const freshOutputSize = project.outputSettings.size;
        // TODO: Do not rely on source[0], find the correct active source or main source.
        const freshInputSize = Object.values(project.sources)[0]?.size;

        if (!freshInputSize) return;

        // 2. Resolve Active Clip & Track & Mouse Effects
        let activeClip = null;
        let activeTrackMotions = null;
        let activeTrackMouseEffects = null;
        try {
            const renderState = ProjectImpl.getRenderState(project, currentTimeMs);
            const activeTrackItem = renderState.tracks.find(t => t.clip);
            activeClip = activeTrackItem?.clip;

            // Find the original track to access motions (assuming renderState might not have them, or just to be safe)
            if (activeTrackItem) {
                const fullTrack = project.timeline.tracks.find(t => t.id === activeTrackItem.trackId);
                activeTrackMotions = fullTrack?.cameraMotions;
                activeTrackMouseEffects = fullTrack?.mouseEffects;
            }
        } catch { /* ignore render errors to prevent crash loop */ }

        // 3. Clear Screen if No Active Clip (or always clear first)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!activeClip) {
            return;
        }

        // 4. Sync Video Element to Virtual Timeline
        const desiredTime = activeClip.sourceTimeMs / 1000;
        if (Math.abs(video.currentTime - desiredTime) > 0.1) {
            video.currentTime = desiredTime;
        }

        // 5. Calculate Draw Dimensions
        const config = new ViewTransform(
            freshInputSize,
            freshOutputSize,
            paddingPercentage
        );

        // 6. Calculate Camera State (Output Space Window)
        const cameraWindow = getCameraStateAtTime(
            activeTrackMotions || [],
            currentTimeMs,
            freshOutputSize // Use Output Size for "Full View" reference
        );

        // 7. Draw the Frame

        if (debugCameraMode === 'visualize') {
            // A. Visualize Mode:
            // 1. Draw Full Content (Zoom 1x view)
            // Camera = Full Output
            const fullView = { x: 0, y: 0, width: freshOutputSize.width, height: freshOutputSize.height };
            const renderRects = config.resolveRenderRects(fullView);

            if (renderRects) {
                ctx.drawImage(
                    video,
                    renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                    renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
                );
            }

            // 2. Draw Camera Window (Green Box)
            // cameraWindow is already in Output/Canvas Space.
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 4;
            ctx.strokeRect(cameraWindow.x, cameraWindow.y, cameraWindow.width, cameraWindow.height);

            // 3. Draw Content Rect (Blue Box) - Optional, helpful for debugging constraints
            ctx.strokeStyle = 'rgba(0, 100, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(config.contentRect.x, config.contentRect.y, config.contentRect.width, config.contentRect.height);

        } else {
            // B. Active Mode: Actual Camera View
            const renderRects = config.resolveRenderRects(cameraWindow);

            if (renderRects) {
                ctx.drawImage(
                    video,
                    renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                    renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
                );
            } else {
                // If null, it means we are looking at purely padding.
                // Draw nothing (already cleared) or draw background color?
            }
        }

        // 8. Draw Mouse Effects (Overlay)
        if (activeTrackMouseEffects && activeTrackMouseEffects.length > 0) {
            // Determine the "Camera" we are drawing into.
            // In 'visualize' mode, we are drawing into the "Full View" camera.
            // In 'active' mode, we are drawing into the actual `cameraWindow`.

            const effectiveCamera = (debugCameraMode === 'visualize')
                ? { x: 0, y: 0, width: freshOutputSize.width, height: freshOutputSize.height }
                : cameraWindow;

            drawMouseEffects(
                ctx,
                activeTrackMouseEffects,
                currentTimeMs,
                effectiveCamera,
                config
            );
        }
    };

    const startRenderLoop = () => {
        const render = () => {
            if (internalVideoRef.current && canvasRef.current) {
                const video = internalVideoRef.current;
                if (!video.paused && !video.ended) {
                    drawVideo(video, canvasRef.current);

                    // Update UI time (throttle this if performance issues arise)
                    useProject.getState().setCurrentTime(video.currentTime * 1000);
                }
            }
            animationFrameRef.current = requestAnimationFrame(render);
        };
        render(); // Start loop
    };

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // Effect to update canvas size if outputVideoSize changes
    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;
            // Trigger a redraw if we have a frame
            const video = internalVideoRef.current;
            if (video && !video.paused && !video.ended) {
                drawVideo(video, canvasRef.current);
            }
        }
    }, [outputVideoSize, inputVideoSize, paddingPercentage]);

    // Effect to handle seeking/updates when paused (to update canvas)
    useEffect(() => {
        const video = internalVideoRef.current;
        if (!video) return;

        const handleSeeked = () => {
            if (canvasRef.current) {
                drawVideo(video, canvasRef.current);
            }
        };

        video.addEventListener('seeked', handleSeeked);
        // Also update on timeupdate just in case
        video.addEventListener('timeupdate', handleSeeked);

        return () => {
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('timeupdate', handleSeeked);
        };
    }, []);


    // Polling draw to ensure we catch frame updates when paused (e.g. after seek)
    // This is a safety net for when 'seeked' events might be missed or debounced.
    useEffect(() => {
        const interval = setInterval(() => {
            const video = internalVideoRef.current;
            if (video && video.paused && canvasRef.current) {
                drawVideo(video, canvasRef.current);
            }
        }, 200); // Reduced frequency
        return () => clearInterval(interval);
    }, []);

    return (
        <>
            {/* Hidden Video Source */}
            <video
                ref={internalVideoRef}
                src={src}
                onLoadedMetadata={handleLoadedMetadata}
                style={{ display: 'none' }}
                muted={muted}
                playsInline
            />

            {/* Render Target */}
            <canvas
                ref={canvasRef}
                style={{
                    backgroundColor: '#000', // Standard Black Background
                    aspectRatio: `${outputVideoSize.width} / ${outputVideoSize.height}`,
                    width: '100%',
                    height: '100%',
                }}
            />
        </>
    );
});

PlayerCanvas.displayName = 'PlayerCanvas';
