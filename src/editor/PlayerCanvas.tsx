import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditorStore } from './store';
import { useZoomSchedule } from './useZoomSchedule';
import { type ZoomKeyframe } from '../lib/zoom';
import { VideoMappingConfig } from '../lib/zoom/videoMappingConfig';

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
    const internalVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>(0);

    // Expose the internal video element to the parent
    useImperativeHandle(ref, () => internalVideoRef.current as HTMLVideoElement);

    const schedule = useZoomSchedule();

    // Metadata handler wrapper
    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        if (onLoadedMetadata) {
            onLoadedMetadata(e);
        }
        // Initialize canvas size once metadata is loaded
        if (canvasRef.current) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;
        }
        startRenderLoop();
    };

    const drawVideo = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.log('No canvas context');
            return;
        }

        if (!inputVideoSize) {
            return;
        }

        const cw = canvas.width;
        const ch = canvas.height;

        const config = new VideoMappingConfig(
            inputVideoSize,
            outputVideoSize,
            paddingPercentage
        );

        ctx.clearRect(0, 0, cw, ch);

        // 1. Draw Video Frame (Cropped/Zoomed)
        const { x, y, width, height } = config.projectedBox;
        ctx.drawImage(video, x, y, width, height);

        // 2. Draw Zoom Box Overlay (Debugging/Visualization)
        const currentMs = video.currentTime * 1000;
        const absTime = currentMs;

        // Find Active Keyframe
        let activeKeyframe: ZoomKeyframe | null = null;
        for (let i = schedule.length - 1; i >= 0; i--) {
            if (absTime >= schedule[i].timestamp) {
                activeKeyframe = schedule[i];
                break;
            }
        }

        if (activeKeyframe) {
            const durationSinceKeyframe = absTime - activeKeyframe.timestamp;
            // Transient Visualization: Only show for 1 second after the keyframe timestamp
            if (durationSinceKeyframe <= 1000) {
                console.log('Active Keyframe', activeKeyframe);
                const { zoomBox } = activeKeyframe;

                ctx.strokeStyle = 'red';
                ctx.lineWidth = 2;
                ctx.strokeRect(zoomBox.x, zoomBox.y, zoomBox.width, zoomBox.height);

                // Label
                ctx.fillStyle = 'green';
                ctx.fillRect(zoomBox.x, zoomBox.y, 60, 15);
                ctx.fillStyle = 'black';
                ctx.font = 'bold 10px Arial';
                ctx.fillText('Zoom Box', zoomBox.x + 2, zoomBox.y + 11);
            }
        }
    };

    const startRenderLoop = () => {
        const render = () => {
            if (internalVideoRef.current && canvasRef.current) {
                const video = internalVideoRef.current;
                if (!video.paused && !video.ended) {
                    drawVideo(video, canvasRef.current);
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


    return (
        <>
            {/* Hidden Video Element - Source */}
            <video
                ref={internalVideoRef}
                src={src}
                onLoadedMetadata={handleLoadedMetadata}
                style={{ display: 'none' }}
                muted={muted}
                playsInline
            />

            {/* Canvas - Render Target */}
            <canvas
                ref={canvasRef}
                style={{
                    backgroundColor: 'blue',
                    aspectRatio: `${outputVideoSize.width} / ${outputVideoSize.height}`,
                    width: '100%',
                    height: '100%',
                }}
            />
        </>
    );
});

PlayerCanvas.displayName = 'PlayerCanvas';
