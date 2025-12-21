import { useRef, useEffect } from 'react';
// import { useEditorStore } from '../store'; // Unused now
import { ViewTransform } from '../../core/effects/viewTransform';
import { getViewportStateAtTime } from '../../core/effects/viewportMotion';
import { drawMouseEffects } from './mousePainter';
import { drawBackground } from './backgroundPainter';
import { drawWebcam } from './webcamPainter';
import { useProjectStore, useProjectData } from '../stores/useProjectStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { ProjectImpl } from '../../core/project/project';



export const PlayerCanvas = () => {
    const project = useProjectData();
    const updateSource = useProjectStore(s => s.updateSource);

    // Playback State (Observed directly in loop)
    // const { isPlaying } = usePlaybackStore();

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
                    const newTime = pbState.currentTimeMs + safeDelta;
                    pbState.setCurrentTime(newTime);
                }
                lastTimeRef.current = time;
            } else {
                lastTimeRef.current = 0;
            }

            // Always render pipeline to ensure UI reflects state (scrubbing, seeking, resizing)
            // Even if paused, we might need to redraw if something changed elsewhere.
            // Optimization: Could check if state changed, but for now 60fps draw is fine for an editor.
            renderPipeline();

            animationFrameRef.current = requestAnimationFrame(tick);
        };

        animationFrameRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, []);

    // Render Pipeline (Ref-stable or accessed via loose closure - 'renderPipeline' uses getState inside)
    const renderPipeline = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const state = useProjectStore.getState();
        const playback = usePlaybackStore.getState();

        const project = state.project;
        const currentTimeMs = playback.currentTimeMs;
        const paddingPercentage = project.timeline.mainTrack?.displaySettings?.padding || 0;
        const outputSize = project.outputSettings.size;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Background
        drawBackground(ctx, project.background, canvas, bgRef.current);

        // Resolve Render State
        let renderState;
        try {
            renderState = ProjectImpl.getRenderState(project, currentTimeMs);
        } catch { return; }

        // Iterate all tracks in order (Main first, then Overlay)
        for (const trackItem of renderState.tracks) {
            if (!trackItem.clip) continue;

            const clip = trackItem.clip;
            const sourceId = clip.source.id;
            const video = internalVideoRefs.current[sourceId];
            const isMainTrack = trackItem.trackId === project.timeline.mainTrack.id;

            if (video) {
                // A. Sync Video Time
                const desiredTimeS = clip.sourceTimeMs / 1000;
                // Resolve speed
                // Ideally we find the specific clip object in the track, but clip.speed might be on the clip object in trackItem? 
                // Wait, ProjectImpl.getRenderState puts 'clip' (which is the object from standard definition) into renderState?
                // Yes, the clip object inside renderState has 'id', 'source', 'sourceTimeMs'. 
                // It does NOT have 'speed' directly unless ProjectImpl included it.
                // ProjectImpl spreads properties? No, it constructs a new object.
                // We should update ProjectImpl to include speed OR look it up.
                // Looking up is expensive in loop.
                // Let's assume for now speed is 1 or look it up efficiently?
                // Actually `clip` in `trackItem` has `.id`. We can find it in the project tracks.

                // Fast lookup:
                let originalClip = null;
                if (isMainTrack) {
                    originalClip = project.timeline.mainTrack.clips.find(c => c.id === clip.id);
                } else if (project.timeline.overlayTrack && trackItem.trackId === project.timeline.overlayTrack.id) {
                    originalClip = project.timeline.overlayTrack.clips.find(c => c.id === clip.id);
                }
                const speed = originalClip?.speed || 1;

                if (playback.isPlaying) {
                    if (video.paused) video.play().catch(() => { });
                    if (Math.abs(video.playbackRate - speed) > 0.01) video.playbackRate = speed;
                    if (Math.abs(video.currentTime - desiredTimeS) > 0.2) video.currentTime = desiredTimeS;
                } else {
                    if (!video.paused) video.pause();
                    if (Math.abs(video.currentTime - desiredTimeS) > 0.001) video.currentTime = desiredTimeS;
                }

                // B. Draw
                const inputSize = video.videoWidth && video.videoHeight
                    ? { width: video.videoWidth, height: video.videoHeight }
                    : clip.source.size;

                if (!inputSize) continue;

                if (isMainTrack) {
                    // MAIN TRACK RENDERING (Viewport Motion)
                    const config = new ViewTransform(inputSize, outputSize, paddingPercentage);
                    const track = project.timeline.mainTrack;
                    const viewportMotions = track?.viewportMotions || [];
                    const effectiveViewport = getViewportStateAtTime(viewportMotions, currentTimeMs, outputSize); // Use global zoom logic

                    const renderRects = config.resolveRenderRects(effectiveViewport);

                    if (renderRects) {
                        ctx.drawImage(
                            video,
                            renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                            renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
                        );
                    }

                    if (track.mouseEffects) {
                        drawMouseEffects(ctx, track.mouseEffects, currentTimeMs, effectiveViewport, config);
                    }
                } else {
                    // OVERLAY TRACK RENDERING (PIP)
                    drawWebcam(ctx, video, outputSize, inputSize);
                }
            }
        }
    };



    // Canvas Sizing
    useEffect(() => {
        if (canvasRef.current && outputVideoSize) {
            canvasRef.current.width = outputVideoSize.width;
            canvasRef.current.height = outputVideoSize.height;
            renderPipeline(); // Force draw on resize
        }
    }, [outputVideoSize.width, outputVideoSize.height]);


    // Handle Metadata Load
    const handleMetadata = (sourceId: string, e: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = e.currentTarget;
        console.log(`[PlayerCanvas] Source Loaded: ${sourceId} (${video.videoWidth}x${video.videoHeight})`);

        // Update Project Store with real dimensions/duration
        updateSource(sourceId, {
            size: { width: video.videoWidth, height: video.videoHeight },
            durationMs: video.duration * 1000,
        });

        // Force re-render pipeline
        renderPipeline();
    };

    return (
        <>
            {/* Hidden Source Container */}
            <div style={{ display: 'none' }}>
                {project.background?.type === 'image' && project.background.imageUrl && (
                    <img
                        ref={bgRef}
                        src={project.background.imageUrl}
                        alt="Background Asset"
                        onLoad={() => renderPipeline()}
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
                            onLoadedMetadata={(e) => handleMetadata(source.id, e)}
                            muted={true}
                            playsInline
                            crossOrigin="anonymous"
                        />
                    ) : null
                ))}
            </div>

            {/* Render Target */}
            <canvas
                ref={canvasRef}
                className="w-full h-full"
                style={{
                    backgroundColor: '#000',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain' // CSS scaling handled by parent
                }}
            />
        </>
    );
};

PlayerCanvas.displayName = 'PlayerCanvas';
