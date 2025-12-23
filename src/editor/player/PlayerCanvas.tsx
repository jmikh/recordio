import { useRef, useEffect } from 'react';
import { drawScreen } from './screenPainter';
import { drawBackground } from './backgroundPainter';
import { drawWebcam } from './webcamPainter';
import { drawKeyboardOverlay } from './keyboardPainter';
import { useProjectStore, useProjectData } from '../stores/useProjectStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { ProjectImpl } from '../../core/project/Project';


export const PlayerCanvas = () => {
    const project = useProjectData();

    // Derived State
    const outputVideoSize = project?.outputSettings?.size || { width: 1920, height: 1080 };
    const sources = project?.sources || {};

    const internalVideoRefs = useRef<{ [sourceId: string]: HTMLVideoElement }>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);

    // Background Image Ref
    const bgRef = useRef<HTMLImageElement>(null);

    // Single Effect to manage the Loop for the lifetime of the component
    useEffect(() => {
        const tick = (time: number) => {
            const pbState = usePlaybackStore.getState();

            if (pbState.isPlaying) {
                if (lastTimeRef.current === 0) lastTimeRef.current = time;
                const delta = time - lastTimeRef.current;

                // Cap delta to prevent huge jumps (e.g. 100ms)
                const safeDelta = Math.min(delta, 100);

                if (safeDelta > 0) {
                    let nextTime = pbState.currentTimeMs + safeDelta;

                    // GAP SKIPPING LOGIC
                    const project = useProjectStore.getState().project;
                    const windows = project.timeline.outputWindows; // Assumed sorted

                    // Check if inside any window
                    // TODO [Optimization]: could keep track of current window index, but linear scan is fine for small N
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

        const state = useProjectStore.getState();
        const playback = usePlaybackStore.getState();

        const project = state.project;
        const currentTimeMs = playback.currentTimeMs;
        const outputSize = project.outputSettings.size;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Background
        drawBackground(ctx, project.background, canvas, bgRef.current);

        // Resolve Render State
        let renderState;
        try {
            renderState = ProjectImpl.getRenderState(project, currentTimeMs);
        } catch {
            console.error('Failed to get render state');
            return;
        }

        if (!renderState.isActive) {
            // Not in an output window or no source, showing background only
            // TODO [MUST FIX]: we should show the screens even if no output window. we might just need to skip all the zooming logic? figure it out later
            return;
        }

        // Render Screen Layer
        if (renderState.screenSource) {
            const source = renderState.screenSource;
            const video = internalVideoRefs.current[source.id];
            if (video) {
                syncVideo(video, renderState.sourceTimeMs / 1000, playback.isPlaying);
                drawScreen(ctx, video, renderState, outputSize, project.background.padding ?? 0.1);
            } else {
                console.error(`[PlayerCanvas] Missing video element for screen source: ${source.id}`);
            }
        }

        // Render Webcam Layer
        if (renderState.cameraSource) {
            const source = renderState.cameraSource;
            const video = internalVideoRefs.current[source.id];
            if (video) {
                // Camera syncs to same time as screen source
                syncVideo(video, renderState.sourceTimeMs / 1000, playback.isPlaying);
                drawWebcam(ctx, video, outputSize, source.size);
            } else {
                console.error(`[PlayerCanvas] Missing video element for webcam source: ${source.id}`);
            }
        }

        // Render Keyboard Overlay
        if (renderState.recording && renderState.recording.keyboardEvents) {
            drawKeyboardOverlay(
                ctx,
                renderState.recording.keyboardEvents,
                renderState.sourceTimeMs,
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


    return (
        <>
            <div style={{ display: 'none' }}>
                {project.background?.type === 'image' && project.background.imageUrl && (
                    <img
                        ref={bgRef}
                        src={project.background.imageUrl}
                        alt="Background Asset"
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
                className="w-full h-full"
                style={{
                    backgroundColor: '#000',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                }}
            />
        </>
    );
};

PlayerCanvas.displayName = 'PlayerCanvas';
