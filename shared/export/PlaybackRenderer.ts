import { drawScreen } from '../painters/screenPainter';
import { paintMouseClicks } from '../painters/mouseClickPainter';
import { drawDragEffects } from '../painters/mouseDragPainter';
import { drawCamera } from '../painters/cameraPainter';
import { drawKeyboardOverlay } from '../painters/keyboardPainter';
import { drawCaptions } from '../painters/captionPainter';
import { drawOverlays } from '../painters/overlayPainter';

import { getViewportStateAtTime } from '../animators/zoomAnimator';
import { getSpotlightStateAtTime } from '../animators/spotlightAnimator';
import { drawSpotlight } from '../painters/spotlightPainter';
import { getResolvedCameraStateAtTime } from '../animators/cameraAnimator';
import type { TimeMapper } from '../mappers/timeMapper';
import type { RenderContext } from '../utils/renderContext';
import type { FocusArea, Project, Rect, Size, CameraSettings, UserEvents } from '../types';

export interface RenderResources {
    ctx: CanvasRenderingContext2D;
    renderCtx: RenderContext;
    bgRef: CanvasImageSource | null;
    videoRefs: { [sourceId: string]: CanvasImageSource };
    deviceFrameImg: CanvasImageSource | null;
    /** Canvas element (or equivalent) for spotlight snapshot */
    sourceCanvas?: CanvasImageSource & Size;
}

export class PlaybackRenderer {
    // Timing accumulators for render profiling (reset externally)
    static _profileAccum: Record<string, number> = {};
    static _profileCount = 0;

    private static _t(label: string, fn: () => void) {
        const t0 = performance.now();
        fn();
        const elapsed = performance.now() - t0;
        PlaybackRenderer._profileAccum[label] = (PlaybackRenderer._profileAccum[label] ?? 0) + elapsed;
    }

    /** Log accumulated render profile and reset. Called from ExportManager every N frames. */
    static flushProfile(frameCount: number): string | null {
        const acc = PlaybackRenderer._profileAccum;
        const keys = Object.keys(acc);
        if (keys.length === 0) return null;
        const parts = keys.map(k => `${k}=${acc[k].toFixed(0)}ms`);
        const total = keys.reduce((s, k) => s + acc[k], 0);
        const msg = `[Render profile] ${frameCount} frames: ${parts.join(' ')} total=${total.toFixed(0)}ms`;
        PlaybackRenderer._profileAccum = {};
        PlaybackRenderer._profileCount = 0;
        return msg;
    }

    static render(
        resources: RenderResources,
        state: {
            project: Project,
            userEvents: UserEvents,
            currentTimeMs: number,
            timeMapper: TimeMapper,
            overrideCameraSettings?: CameraSettings,
            focusAreas?: FocusArea[],
            showDebugOverlays?: boolean
        }
    ) {
        PlaybackRenderer._profileCount++;
        const { ctx, renderCtx, videoRefs } = resources;
        const { project, currentTimeMs, userEvents } = state;
        const outputSize = project.settings.outputSize;

        const { timeline } = project;

        const screenSource = project.screenSource;
        const cameraSource = project.cameraSource;

        // -----------------------------------------------------------
        // VIEWPORT CALCULATION
        // -----------------------------------------------------------
        let effectiveViewport: Rect;

        const zoomSegments = (project.settings.zoom.enabled ?? true)
            ? (timeline.zoomSegments || [])
            : [];
        const { timeMapper } = state;

        effectiveViewport = getViewportStateAtTime(
            zoomSegments,
            currentTimeMs,
            outputSize,
            project.settings.zoom
        );
        // -----------------------------------------------------------

        // Render Screen Layer
        let viewMapper: import('../mappers/viewMapper').ViewMapper | undefined;

        const screenVideo = videoRefs[screenSource.id];
        if (screenVideo) {
            this._t('screen', () => {
                const result = drawScreen(
                    ctx,
                    screenVideo,
                    project,
                    effectiveViewport,
                    resources.deviceFrameImg,
                    currentTimeMs,
                    state.timeMapper,
                    userEvents?.urlChanges
                );
                viewMapper = result.viewMapper;
            });

            // Mouse click/drag effects (visual only — audio is handled by the caller)
            const mouse = project.settings.mouse;
            if (mouse) {
                if (mouse.mouseClickEnabled) {
                    this._t('mouseClick', () => {
                        paintMouseClicks(ctx, userEvents.mouseClicks, currentTimeMs, effectiveViewport, viewMapper!, mouse, timeMapper, project.settings.outputSize);
                    });
                }
                if (mouse.mouseDragEnabled) {
                    this._t('mouseDrag', () => {
                        drawDragEffects(ctx, userEvents, currentTimeMs, effectiveViewport, viewMapper!, mouse, timeMapper, project.settings.outputSize);
                    });
                }
            }
        }


        // Render Spotlight Overlay (after screen + effects, before keyboard/camera)
        // Spotlight samples the canvas as-is, so mouse clicks/drags are captured
        if (viewMapper && (project.settings.spotlight.enabled ?? true)) {
            this._t('spotlight', () => {
                const spotlightState = getSpotlightStateAtTime(
                    timeline.spotlightSegments || [],
                    project.settings.spotlight,
                    currentTimeMs,
                    effectiveViewport,
                    viewMapper!
                );

                drawSpotlight(ctx, spotlightState, outputSize, resources.sourceCanvas, renderCtx);
            });
        }

        // Render Keyboard Overlay (after spotlight, so it appears on top of dimming)
        if (project.settings.keyboard?.showHotkeys ?? true) {
            this._t('keyboard', () => {
                drawKeyboardOverlay(
                    ctx,
                    userEvents.keyboardEvents,
                    currentTimeMs,
                    outputSize,
                    timeMapper,
                    project.settings.keyboard
                );
            });
        }


        // Render Overlay annotations (before camera, so camera always appears on top)
        if (project.settings.overlay?.enabled ?? true) {
            const overlaySegments = timeline.overlaySegments || [];
            if (overlaySegments.length > 0) {
                this._t('overlays', () => {
                    drawOverlays(ctx, overlaySegments, currentTimeMs, outputSize, effectiveViewport);
                });
            }
        }

        // Render Camera Layer (after overlays, so camera always appears on top)
        if (cameraSource) {
            const video = videoRefs[cameraSource.id];
            if (video) {
                const cameraSettings = project.settings.camera;

                if (!cameraSettings) {
                    console.error(`[PlaybackRenderer] Missing camera settings for source ${cameraSource.id}`);
                    throw new Error("Mandatory camera settings are missing.");
                }

                this._t('camera', () => {
                    if (state.overrideCameraSettings) {
                        // Override mode (drag preview): use provided settings directly, no resolver
                        drawCamera(ctx, video, cameraSource.size, state.overrideCameraSettings!, outputSize, renderCtx);
                    } else {
                        // Use the unified resolver: layout blocks → transitions → auto-shrink
                        const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;
                        const resolved = getResolvedCameraStateAtTime(
                            cameraSettings,
                            cameraMoveEnabled ? (timeline.cameraMoveSegments || []) : [],
                            zoomSegments,
                            currentTimeMs,
                            outputSize,
                            project.settings.zoom
                        );

                        if (resolved.opacity > 0) {
                            const effectiveSettings: CameraSettings = {
                                ...cameraSettings,
                                xPx: resolved.xPx,
                                yPx: resolved.yPx,
                                widthPx: resolved.widthPx,
                                heightPx: resolved.heightPx,
                                shape: resolved.shape,
                                borderRadiusPx: resolved.borderRadiusPx,
                            };

                            // Apply opacity for fade transitions (hidden blocks)
                            if (resolved.opacity < 1) {
                                ctx.save();
                                ctx.globalAlpha = resolved.opacity;
                                drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
                                ctx.restore();
                            } else {
                                drawCamera(ctx, video, cameraSource.size, effectiveSettings, outputSize, renderCtx);
                            }
                        }
                    }
                });
            }
        }

        // Render Captions (on top of everything including spotlight)
        if (project.settings.captions.enabled ?? true) {
            this._t('captions', () => {
                drawCaptions(
                    ctx,
                    timeline.captionSegments,
                    project.settings.captions,
                    currentTimeMs,
                    outputSize
                );
            });
        }
    }
}
