import type { Project, Rect, Size } from '../types';
import type { UrlChangeEvent } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';
import type { RenderContext } from '../utils/renderContext';
import { getDeviceFrame } from '../utils/deviceFrames';
import { drawDeviceFrame } from './smartFramePainter';
import { drawToolbar, getUrlAtTime } from './toolbarPainter';
import { roundRectPath } from './utils/roundRect';
import { applyStyleEffect, DEFAULT_EFFECT_AMOUNT } from './utils/outlineEffects';

const REF_OUTPUT_HEIGHT = 1080;

/**
 * Helper to define the rounded path for the FULL screen content.
 */
function defineScreenPath(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    radius: number
) {
    roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
}

/**
 * Resolves the drawable size of the screen source.
 * Supports HTMLVideoElement (videoWidth), VideoFrame (displayWidth), and generic CanvasImageSource (width).
 */
export function getScreenInputSize(video: CanvasImageSource, project: Project): Size {
    const v = video as any;
    const inputSize = v.displayWidth
        ? { width: v.displayWidth, height: v.displayHeight }
        : v.videoWidth
            ? { width: v.videoWidth, height: v.videoHeight }
            : v.width
                ? { width: v.width, height: v.height }
                : project.screenSource.size;

    if (!inputSize || inputSize.width === 0) {
        throw new Error(`[drawScreen] Invalid inputSize for screen.`);
    }
    return inputSize;
}

/**
 * Builds the ViewMapper used to place the screen recording on the output canvas.
 */
export function createScreenViewMapper(project: Project, inputSize: Size): ViewMapper {
    const screen = project.settings.screen;

    // Resolve device frame (if in device mode) so ViewMapper can apply frame-first padding
    const deviceFrame = screen.mode === 'device' ? getDeviceFrame(screen.deviceFrameId) : undefined;

    // Pass the crop settings and device frame to the ViewMapper
    return new ViewMapper(
        inputSize, project.settings.outputSize, screen.padding,
        screen.crop,
        project.screenSource.trackableContentRect,
        screen.toolbar.enabled,
        deviceFrame
    );
}

/**
 * Address-bar text for the custom toolbar at the given output time:
 * the URL active at the mapped source time, or the project name as fallback.
 */
export function getToolbarAddressText(
    project: Project,
    currentOutputTimeMs: number | undefined,
    timeMapper: TimeMapper | undefined,
    urlChanges: UrlChangeEvent[] | undefined,
    projectName: string | undefined
): string {
    const sourceTimeMs = currentOutputTimeMs !== undefined && timeMapper
        ? timeMapper.mapOutputToSourceTime(currentOutputTimeMs)
        : undefined;
    return urlChanges && sourceTimeMs !== undefined && sourceTimeMs !== -1
        ? getUrlAtTime(urlChanges, sourceTimeMs, projectName ?? '', project.settings.screen.toolbar.urlMode)
        : projectName ?? '';
}

/**
 * Draws the screen recording frame.
 * Encapsulates logic for viewport calculation.
 * Returns the viewMapper used, so caller can draw overlays.
 */
export function drawScreen(
    ctx: CanvasRenderingContext2D,
    video: CanvasImageSource,
    project: Project,
    effectiveViewport: Rect, // Injected from caller
    deviceFrameImg: CanvasImageSource | null, // Cached device frame image
    currentOutputTimeMs?: number, // Current playback time (output) for URL lookup
    timeMapper?: TimeMapper, // For converting output time → source time
    urlChanges?: UrlChangeEvent[], // URL change events (passed explicitly; project.userEvents separated from project at runtime)
    projectName?: string, // Project name for toolbar fallback (stored as DB column, not in project)
    renderCtx?: RenderContext, // For loading images (toolbar icons, etc.)
): { viewMapper: ViewMapper } {
    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadiusPx: 24,
        borderColor: '#ffffff',
        effect: 'shadow',
        effectAmount: DEFAULT_EFFECT_AMOUNT
    };

    // 1. Resolve video dimensions from the source
    const inputSize = getScreenInputSize(video, project);

    // 3. Resolve View Mapping
    const outputSize = project.settings.outputSize;

    const isDeviceMode = screenConfig.mode === 'device';
    const deviceFrame = isDeviceMode ? getDeviceFrame(screenConfig.deviceFrameId) : undefined;

    const viewMapper = createScreenViewMapper(project, inputSize);

    // 4. Calculate Rects
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);

    if (renderRects) {
        // Note: borderRadius scaling happens in the Project.scaleToResolution function

        // Calculate Project Rect (Logical Screen on Canvas)
        const logicalScreenRect = viewMapper.getProjectedSubjectRect(effectiveViewport);
        const originX = logicalScreenRect.x;
        const originY = logicalScreenRect.y;
        const projectedW = logicalScreenRect.width;
        const projectedH = logicalScreenRect.height;

        // Compute the full content rect (toolbar + video) from ViewMapper
        // Scale toolbar height by zoom factor so it tracks with the content
        const zoomScale = viewMapper.getZoomScale(effectiveViewport);
        const toolbarH = viewMapper.toolbarOutputHeight * zoomScale;
        const hasCustomToolbar = toolbarH > 0;
        const contentRect: Rect = {
            x: originX,
            y: originY - toolbarH,
            width: projectedW,
            height: projectedH + toolbarH
        };
        const toolbarRect: Rect = {
            x: originX,
            y: originY - toolbarH,
            width: projectedW,
            height: toolbarH
        };

        ctx.save();

        if (isDeviceMode) {
            // ============================
            // MODE: DEVICE FRAME
            // ============================

            // Draw custom toolbar (if active), then video
            if (hasCustomToolbar) {
                const addressText = getToolbarAddressText(project, currentOutputTimeMs, timeMapper, urlChanges, projectName);
                drawToolbar(ctx, toolbarRect, addressText, project.settings.screen.toolbar, renderCtx);
            }

            // Draw video content (positioned by ViewMapper's contentRect)
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );

            // Draw Device Frame Overlay — zoom-aware frame rect
            const projectedFrameRect = viewMapper.getProjectedFrameRect(effectiveViewport);
            const frameReady = deviceFrameImg && ('complete' in deviceFrameImg ? (deviceFrameImg as HTMLImageElement).complete : true);
            if (deviceFrame && frameReady && projectedFrameRect) {
                drawDeviceFrame(ctx, deviceFrame, deviceFrameImg, projectedFrameRect);
            }

        } else {
            // ============================
            // MODE: BORDER / CUSTOM
            // ============================
            const { borderRadiusPx: borderRadius = 0 } = screenConfig;

            // Scale shadow/glow relative to output height
            const effectScale = outputSize.height / REF_OUTPUT_HEIGHT;

            // --- PASS 1: GLOW/SHADOW — the caster is just the filled content shape ---
            ctx.save();
            const casterFill = applyStyleEffect(ctx, screenConfig, effectScale);
            if (casterFill) {
                defineScreenPath(ctx, contentRect, borderRadius);
                ctx.fillStyle = casterFill;
                ctx.fill();
            }
            ctx.restore();

            // --- PASS 2: VIDEO CONTENT + TOOLBAR (Clipped) ---
            ctx.save();
            defineScreenPath(ctx, contentRect, borderRadius);
            ctx.clip();

            // Draw custom toolbar in the top portion
            if (hasCustomToolbar) {
                const addressText = getToolbarAddressText(project, currentOutputTimeMs, timeMapper, urlChanges, projectName);
                drawToolbar(ctx, toolbarRect, addressText, project.settings.screen.toolbar, renderCtx);
            }

            // Draw video content (destRect is already positioned below toolbar by ViewMapper)
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );
            ctx.restore();
        }

        ctx.restore();
    }

    return { viewMapper };
}
