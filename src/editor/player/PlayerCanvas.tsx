import { useRef, useEffect } from 'react';
// import { useEditorStore } from '../store'; // Unused now
import { ViewTransform } from '../../core/effects/viewTransform';
import { getCameraStateAtTime } from '../../core/effects/cameraMotion';
import { drawMouseEffects } from './mousePainter';
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

        // Resolve Render State
        let renderState;
        try {
            renderState = ProjectImpl.getRenderState(project, currentTimeMs);
        } catch { return; }

        // Find active clip(s)
        const trackItem = renderState.tracks.find(t => t.clip);
        if (!trackItem || !trackItem.clip) return;

        const clip = trackItem.clip;
        const sourceId = clip.source.id;
        const video = internalVideoRefs.current[sourceId];

        if (video) {
            // A. Sync Video Time
            const desiredTimeS = clip.sourceTimeMs / 1000;

            // Only sync if significant drift or separate state
            if (Math.abs(video.currentTime - desiredTimeS) > 0.1) {
                video.currentTime = desiredTimeS;
            }

            // B. Draw
            const inputSize = video.videoWidth && video.videoHeight
                ? { width: video.videoWidth, height: video.videoHeight }
                : clip.source.size;

            if (!inputSize) return;

            const config = new ViewTransform(inputSize, outputSize, paddingPercentage);

            // Camera Internal
            const track = project.timeline.mainTrack;
            const cameraMotions = track?.cameraMotions || [];

            // Debug Zoom
            if (Math.random() < 0.01) {
                // console.log('Zoom Debug:', { hasTrack: !!track, motions: cameraMotions.length, ct: currentTimeMs });
            }

            const cameraWindow = getCameraStateAtTime(cameraMotions, currentTimeMs, outputSize);

            // Active Camera Mode (Always Active)
            const effectiveCamera = cameraWindow;
            const renderRects = config.resolveRenderRects(effectiveCamera);

            if (renderRects) {
                ctx.drawImage(
                    video,
                    renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                    renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
                );
            }

            if (track.mouseEffects) {
                drawMouseEffects(ctx, track.mouseEffects, currentTimeMs, effectiveCamera, config);
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
