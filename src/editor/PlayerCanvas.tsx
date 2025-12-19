import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditorStore } from './store';
import { VideoMappingConfig } from '../core/effects/videoMappingConfig';
import { getCameraStateAtTime } from '../core/effects/cameraMotion';
import { drawMouseEffects } from '../core/effects/mouseEffects';
import { useProject } from '../hooks/useProject';
import { ProjectImpl } from '../core/project/project';

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

        // 3. Clear Screen if No Active Clip
        if (!activeClip) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // 4. Sync Video Element to Virtual Timeline
        const desiredTime = activeClip.sourceTimeMs / 1000;
        if (Math.abs(video.currentTime - desiredTime) > 0.1) {
            video.currentTime = desiredTime;
        }

        // 5. Calculate Draw Dimensions
        const config = new VideoMappingConfig(
            freshInputSize,
            freshOutputSize,
            paddingPercentage
        );

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 6. Calculate Camera State (Source Zoom)
        // We want the camera state at the current TIMELINE time relative to the track/clip? 
        // `activeClip` gives us the scheduled clip.
        // `cameraMotion.ts` logic takes `timeMs` and `motions`.
        // The `motions` are defined on the TRACK timeline (global timeline time).
        // So we pass `currentTimeMs`.

        const sourceRect = getCameraStateAtTime(
            activeTrackMotions || [],
            currentTimeMs,
            freshInputSize
        );

        // 7. Draw the Frame
        // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);

        const { x, y, width, height } = config.projectedBox;

        if (debugCameraMode === 'visualize') {
            // A. Full Picture + Rectangle
            // 1. Draw full video to fit canvas
            ctx.drawImage(video, x, y, width, height);

            // 2. Draw Debug Rect
            // sourceRect is in Source Coordinates. We need to project it to Canvas Coordinates.
            // Canvas "full" area is defined by projectedBox (x, y, width, height).
            // Scale factors:
            const scaleX = width / freshInputSize.width;
            const scaleY = height / freshInputSize.height;

            const rectX = x + sourceRect.x * scaleX;
            const rectY = y + sourceRect.y * scaleY;
            const rectW = sourceRect.width * scaleX;
            const rectH = sourceRect.height * scaleY;

            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 4;
            ctx.strokeRect(rectX, rectY, rectW, rectH);

        } else {
            // B. Actual Camera Zoom
            ctx.drawImage(
                video,
                sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
                x, y, width, height
            );
        }

        // 8. Draw Mouse Effects (Overlay)
        // Only draw if we have effects and are not in pure debug mode (or maybe allow it in debug too?)
        // Let's allow it, but we need correct coordinate mapping.
        if (activeTrackMouseEffects && activeTrackMouseEffects.length > 0) {
            // Define Destination Rect (Canvas Draw Area)
            // If debug mode 'visualize', dest is the centered box containing full video.
            // If debug mode 'active', dest is the centered box containing ZOOMED video.

            // Fortunately `getCameraStateAtTime` returns `sourceRect`.
            // And `config.projectedBox` returns the layout on canvas `destRect` (x,y,w,h).
            // BUT:
            // In 'visualize' mode: 'sourceRect' used for drawing is FULL rect? No. 
            // In 'visualize' mode logic:
            //   ctx.drawImage(video, x, y, width, height); -> Input is Full Frame. 
            //   So effective "sourceRect" for the projection of mouse events is the FULL frame {0,0,w,h}.
            // In 'active' mode:
            //   ctx.drawImage(video, sourceRect...) -> Input is Zoomed Frame.
            //   So effective "sourceRect" is `sourceRect`.

            const effectiveSourceRect = (debugCameraMode === 'visualize')
                ? { x: 0, y: 0, width: freshInputSize.width, height: freshInputSize.height }
                : sourceRect;

            drawMouseEffects(
                ctx,
                activeTrackMouseEffects,
                currentTimeMs,
                effectiveSourceRect,
                { x, y, width, height } // destRect (projectedBox)
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
