import type { Project, Rect } from '../types';
import type { UrlChangeEvent } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';
import { getDeviceFrame } from '../utils/deviceFrames';
import { drawDeviceFrame } from './smartFramePainter';
import { drawToolbar, getUrlAtTime } from './toolbarPainter';
import { roundRectPath } from './utils/roundRect';

const REF_OUTPUT_HEIGHT = 1080;
const REF_SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const REF_SHADOW_OFFSET_Y = 10;
const REF_GLOW_BLUR = 25;

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
): { viewMapper: ViewMapper } {
    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadiusPx: 24,
        borderWidthPx: 0,
        borderColor: '#ffffff',
        hasShadow: true,
        hasGlow: false
    };

    // 1. Resolve video dimensions from the source
    // Supports HTMLVideoElement (videoWidth), VideoFrame (displayWidth), and generic CanvasImageSource (width)
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

    // 3. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.screen.padding;

    // Resolve device frame (if in device mode) so ViewMapper can apply frame-first padding
    const isDeviceMode = screenConfig.mode === 'device';
    const deviceFrame = isDeviceMode ? getDeviceFrame(screenConfig.deviceFrameId) : undefined;

    // Pass the crop settings and device frame to the ViewMapper
    const viewMapper = new ViewMapper(
        inputSize, outputSize, padding,
        project.settings.screen.crop,
        project.screenSource.trackableContentRect,
        project.settings.screen.toolbar.enabled,
        deviceFrame
    );

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
                const sourceTimeMs = currentOutputTimeMs !== undefined && timeMapper
                    ? timeMapper.mapOutputToSourceTime(currentOutputTimeMs)
                    : undefined;
                const toolbarSettings = project.settings.screen.toolbar;
                const addressText = urlChanges && sourceTimeMs !== undefined && sourceTimeMs !== -1
                    ? getUrlAtTime(urlChanges, sourceTimeMs, projectName ?? '', toolbarSettings.urlMode)
                    : projectName ?? '';

                drawToolbar(ctx, toolbarRect, addressText, toolbarSettings);
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
            const {
                borderRadiusPx: borderRadius = 0,
                borderWidthPx: borderWidth = 0,
                borderColor = '#ffffff',
                hasShadow = false,
                hasGlow = false
            } = screenConfig;

            // Scale shadow/glow relative to output height
            const effectScale = outputSize.height / REF_OUTPUT_HEIGHT;
            const shadowBlur = REF_SHADOW_BLUR * effectScale;
            const shadowOffsetY = REF_SHADOW_OFFSET_Y * effectScale;
            const glowBlur = REF_GLOW_BLUR * effectScale;

            const renderBorderWidth = borderWidth;

            // Outset rect so the border stroke sits entirely OUTSIDE the content
            const halfBW = renderBorderWidth / 2;
            const borderOutsetRect: Rect = {
                x: contentRect.x - halfBW,
                y: contentRect.y - halfBW,
                width: contentRect.width + renderBorderWidth,
                height: contentRect.height + renderBorderWidth
            };

            // --- PASS 1: GLOW ---
            if (hasGlow) {
                ctx.save();
                defineScreenPath(ctx, borderOutsetRect, borderRadius + halfBW);
                ctx.shadowColor = borderColor;
                ctx.shadowBlur = glowBlur;
                ctx.fillStyle = borderColor;
                ctx.fill();

                if (renderBorderWidth > 0) {
                    ctx.lineWidth = renderBorderWidth;
                    ctx.strokeStyle = borderColor;
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- PASS 2: SHADOW ---
            if (hasShadow) {
                ctx.save();
                defineScreenPath(ctx, borderOutsetRect, borderRadius + halfBW);
                ctx.shadowColor = SHADOW_COLOR;
                ctx.shadowBlur = shadowBlur;
                ctx.shadowOffsetY = shadowOffsetY;
                ctx.fillStyle = 'black';
                ctx.fill();

                if (renderBorderWidth > 0) {
                    ctx.lineWidth = renderBorderWidth;
                    ctx.strokeStyle = 'black';
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- PASS 3: VIDEO CONTENT + TOOLBAR (Clipped) ---
            ctx.save();
            defineScreenPath(ctx, contentRect, borderRadius);
            ctx.clip();

            // Draw custom toolbar in the top portion
            if (hasCustomToolbar) {
                const sourceTimeMs = currentOutputTimeMs !== undefined && timeMapper
                    ? timeMapper.mapOutputToSourceTime(currentOutputTimeMs)
                    : undefined;
                const toolbarSettings = project.settings.screen.toolbar;
                const addressText = urlChanges && sourceTimeMs !== undefined && sourceTimeMs !== -1
                    ? getUrlAtTime(urlChanges, sourceTimeMs, projectName ?? '', toolbarSettings.urlMode)
                    : projectName ?? '';

                drawToolbar(ctx, toolbarRect, addressText, toolbarSettings);
            }

            // Draw video content (destRect is already positioned below toolbar by ViewMapper)
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );
            ctx.restore();

            // --- PASS 4: BORDER ---
            if (renderBorderWidth > 0) {
                ctx.save();
                defineScreenPath(ctx, borderOutsetRect, borderRadius + halfBW);
                ctx.lineWidth = renderBorderWidth;
                ctx.strokeStyle = borderColor;
                ctx.stroke();
                ctx.restore();
            }
        }

        ctx.restore();
    }

    return { viewMapper };
}
