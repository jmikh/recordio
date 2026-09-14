import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { PlaybackRenderer } from '@shared/export/PlaybackRenderer';
import { drawBackground } from '@shared/painters/backgroundPainter';
import { browserRenderContext } from '../../../editor/utils/renderContext';
import { getTimeMapper } from '../../../editor/hooks/useTimeMapper';
import { useProjectStore } from '../../../editor/stores/useProjectStore';
import { buildEffectDemo, type DemoClip, type DemoKind } from '../../../core/effectDemos';
import { STILL_TIME_MS } from '../../../core/defaultsTemplate';
import { useDefaultsPreviewStore } from '../../../editor/stores/useDefaultsPreviewStore';

type ImgRef = RefObject<HTMLImageElement | null>;

/** A hidden <img> that is actually decoded; otherwise the layer is skipped. */
const loaded = (img: HTMLImageElement | null) =>
    img && img.complete && img.naturalWidth > 0 ? img : null;

/**
 * Draws the Personal Settings preview (plans/user-default-project-settings
 * §3.8) with the shared playback renderer:
 * - the STILL: one coalesced frame at STILL_TIME_MS whenever the template
 *   project or a resource changes (no render loop);
 * - a DEMO: a rAF loop over an ephemeral clip from effectDemos.ts, requested
 *   through useDefaultsPreviewStore by the settings column's Preview buttons.
 *   Settings are re-read from the store every frame, so slider changes show
 *   live while a demo plays.
 */
export function useDefaultsPreviewRenderer(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    backgroundRef: ImgRef,
    deviceFrameRef: ImgRef,
    screenRef: ImgRef,
    cameraRef: ImgRef,
) {
    const rafRef = useRef<number | null>(null);
    const demoRef = useRef<{ clip: DemoClip; startedAt: number } | null>(null);

    const renderFrame = useCallback((timeMs: number, clip: DemoClip | null) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const { project, projectName, userEvents, templateMode } = useProjectStore.getState();
        if (!templateMode) return;

        const { outputSize } = project.settings;
        if (canvas.width !== outputSize.width || canvas.height !== outputSize.height) {
            canvas.width = outputSize.width;
            canvas.height = outputSize.height;
        }

        const bgImg = loaded(backgroundRef.current);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBackground(ctx, project.settings.background, project.settings.background.backgroundBlurPx, outputSize, bgImg);

        const videoRefs: Record<string, CanvasImageSource> = {};
        const screenImg = loaded(screenRef.current);
        if (screenImg) videoRefs[project.screenSource.storagePath] = screenImg;
        const cameraImg = loaded(cameraRef.current);
        if (cameraImg && project.cameraSource) videoRefs[project.cameraSource.storagePath] = cameraImg;

        const frameProject = clip
            ? {
                ...project,
                timeline: {
                    ...project.timeline,
                    zoomSegments: clip.zoomSegments,
                    spotlightSegments: clip.spotlightSegments,
                },
            }
            : project;

        try {
            PlaybackRenderer.render(
                {
                    ctx,
                    renderCtx: browserRenderContext,
                    bgRef: bgImg,
                    videoRefs,
                    deviceFrameImg: loaded(deviceFrameRef.current),
                    sourceCanvas: canvas,
                },
                {
                    project: frameProject,
                    projectName,
                    userEvents: clip ? clip.userEvents : userEvents,
                    currentTimeMs: timeMs,
                    timeMapper: getTimeMapper(project.timeline.outputWindows),
                },
            );
        } catch (err) {
            console.error('[DefaultsPreview] render failed', err);
        }
    }, [canvasRef, backgroundRef, deviceFrameRef, screenRef, cameraRef]);

    /** Redraw the still on the next frame (coalesces bursts of changes). No-op while a demo plays. */
    const scheduleStill = useCallback(() => {
        if (demoRef.current) return;
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            renderFrame(STILL_TIME_MS, null);
        });
    }, [renderFrame]);

    const stopDemo = useCallback(() => {
        demoRef.current = null;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        useDefaultsPreviewStore.getState().setPlaying(null);
        renderFrame(STILL_TIME_MS, null);
    }, [renderFrame]);

    const playDemo = useCallback((kind: DemoKind) => {
        const { project } = useProjectStore.getState();
        const clip = buildEffectDemo(kind, project);
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        demoRef.current = { clip, startedAt: performance.now() };
        useDefaultsPreviewStore.getState().setPlaying(kind);

        const tick = () => {
            const demo = demoRef.current;
            if (!demo) return;
            const elapsed = performance.now() - demo.startedAt;
            if (elapsed >= demo.clip.durationMs) {
                stopDemo();
                return;
            }
            renderFrame(elapsed, demo.clip);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [renderFrame, stopDemo]);

    // Requests from the settings column (a new nonce per press)
    const requested = useDefaultsPreviewStore(s => s.requested);
    useEffect(() => {
        if (!requested) {
            if (demoRef.current) stopDemo();
            return;
        }
        playDemo(requested.kind);
    }, [requested, playDemo, stopDemo]);

    // Unmount: drop the loop; nothing else to release
    useEffect(() => () => {
        demoRef.current = null;
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }, []);

    return { scheduleStill };
}
