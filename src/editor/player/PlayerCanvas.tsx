import { useRef, useEffect } from 'react';
import { drawScreen } from './screenPainter';
import { drawBackground } from './backgroundPainter';
import { drawWebcam } from './webcamPainter';
import { drawKeyboardOverlay } from './keyboardPainter';
import { useProjectStore, useProjectData } from '../stores/useProjectStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';

export const PlayerCanvas = () => {
    const project = useProjectData();

    // Derived State
    const outputVideoSize = project?.settings?.outputSize || { width: 1920, height: 1080 };
    const sources = project?.sources || {};

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

            // FPS Counter
            frameCount++;
            if (time - lastFpsTime >= 1000) {
                // console.log(`[PlayerCanvas] tick FPS: ${frameCount}`);
                frameCount = 0;
                lastFpsTime = time;
            }

            if (pbState.isPlaying) {
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

        const { project, userEvents } = useProjectStore.getState();
        const playback = usePlaybackStore.getState();

        const currentTimeMs = playback.currentTimeMs;
        const outputSize = project.settings.outputSize;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);


        drawBackground(ctx, project.settings, canvas, bgRef.current);

        const { timeline, sources } = project;
        const { recording, outputWindows } = timeline;

        // 1. Check if ACTIVE
        const activeWindow = outputWindows.find(w => currentTimeMs >= w.startMs && currentTimeMs < w.endMs);
        if (!activeWindow) {
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

        // Render Screen Layer
        if (screenSource) {
            const video = internalVideoRefs.current[screenSource.id];
            if (video) {
                syncVideo(video, sourceTimeMs / 1000, playback.isPlaying);

                drawScreen(
                    ctx,
                    video,
                    project,
                    userEvents,
                    currentTimeMs
                );
            } else {
                // If video not ready, maybe draw black rect?
            }
        }

        // Render Webcam Layer
        if (cameraSource) {
            const video = internalVideoRefs.current[cameraSource.id];
            if (video) {
                // Camera syncs to same time as screen source
                syncVideo(video, sourceTimeMs / 1000, playback.isPlaying);
                drawWebcam(ctx, video, outputSize, cameraSource.size);
            }
        }

        // Render Keyboard Overlay
        if (userEvents && userEvents.keyboardEvents) {

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


    return (
        <>
            <div style={{ display: 'none' }}>
                {project.settings.backgroundType === 'image' && project.settings.backgroundImageUrl && (
                    <img
                        ref={bgRef}
                        src={project.settings.backgroundImageUrl}
                        className="hidden" // Just for loading
                        onLoad={() => {
                            // Trigger re-render
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
