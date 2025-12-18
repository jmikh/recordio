import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditorStore } from './store';
import { VideoMappingConfig } from '../lib/zoom/videoMappingConfig';
import { useProject } from '../hooks/useProject';
import { ProjectImpl } from '../core/project/Project';

interface PlayerCanvasProps {
    src: string;
    onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    className?: string;
    muted?: boolean;
}

export const PlayerCanvas = forwardRef<HTMLVideoElement, PlayerCanvasProps>(({
    src,
    onLoadedMetadata,
    muted = true
}, ref) => {
    // We need some store values for sizing, but schedule comes from hook
    const { outputVideoSize, inputVideoSize, paddingPercentage } = useEditorStore();
    const { project, currentTimeMs, setCurrentTime } = useProject();

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
        if (canvasRef.current) {
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
        const { project, currentTimeMs } = useProject.getState();
        const { inputVideoSize, outputVideoSize, paddingPercentage } = useEditorStore.getState();

        if (!inputVideoSize) return;

        // 2. Resolve Active Clip
        let activeClip = null;
        try {
            const renderState = ProjectImpl.getRenderState(project, currentTimeMs);
            const activeTrackItem = renderState.tracks.find(t => t.clip);
            activeClip = activeTrackItem?.clip;
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
            inputVideoSize,
            outputVideoSize,
            paddingPercentage
        );

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 6. Draw the Frame
        const { x, y, width, height } = config.projectedBox;
        ctx.drawImage(video, x, y, width, height);
    };

    const startRenderLoop = () => {
        const render = () => {
            if (internalVideoRef.current && canvasRef.current) {
                const video = internalVideoRef.current;
                if (!video.paused && !video.ended) {
                    drawVideo(video, canvasRef.current);

                    // Update UI time (throttle this if performance issues arise)
                    setCurrentTime(video.currentTime * 1000);
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
