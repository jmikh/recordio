import type { Project, Rect } from '../../types';
import type { UrlChangeEvent } from '@shared/types';
import { ViewMapper } from '../mappers/viewMapper';
import type { TimeMapper } from '../mappers/timeMapper';
import { getDeviceFrame } from '../deviceFrames';
import { drawDeviceFrame } from './smartFramePainter';
import { drawToolbar, getUrlAtTime } from './toolbarPainter';

const SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const SHADOW_OFFSET_Y = 10;
const GLOW_BLUR = 25;

/**
 * Helper to define the rounded path for the FULL screen content.
 */
function defineScreenPath(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    radius: number
) {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
}

/**
 * Draws the screen recording frame.
 * Encapsulates logic for viewport calculation.
 * Returns the viewMapper used, so caller can draw overlays.
 */
export function drawScreen(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    project: Project,
    effectiveViewport: Rect, // Injected from caller
    deviceFrameImg: HTMLImageElement | null, // Cached device frame image
    currentOutputTimeMs?: number, // Current playback time (output) for URL lookup
    timeMapper?: TimeMapper, // For converting output time → source time
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

    // 1. Use video dimensions if available, otherwise project's screenSource size
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : project.screenSource.size;

    if (!inputSize || inputSize.width === 0) {
        throw new Error(`[drawScreen] Invalid inputSize for screen.`);
    }

    // 3. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.screen.padding;
    // Pass the crop settings to the ViewMapper
    const viewMapper = new ViewMapper(
        inputSize, outputSize, padding,
        project.settings.screen.crop,
        project.screenSource.trackableContentRect,
        project.settings.screen.toolbar.enabled
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

        const isDeviceMode = screenConfig.mode === 'device';

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
                const urlChanges = project.userEvents?.urlChanges as UrlChangeEvent[] | undefined;
                const sourceTimeMs = currentOutputTimeMs !== undefined && timeMapper
                    ? timeMapper.mapOutputToSourceTime(currentOutputTimeMs)
                    : undefined;
                const toolbarSettings = project.settings.screen.toolbar;
                const addressText = urlChanges && sourceTimeMs !== undefined && sourceTimeMs !== -1
                    ? getUrlAtTime(urlChanges, sourceTimeMs, project.name, toolbarSettings.urlMode)
                    : project.name;

                drawToolbar(ctx, toolbarRect, addressText, toolbarSettings);
            }

            // Draw video content (positioned by ViewMapper's contentRect)
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );

            // Draw Device Frame Overlay — wraps the full frame (toolbar + content)
            const deviceFrame = getDeviceFrame(screenConfig.deviceFrameId);
            if (deviceFrame && deviceFrameImg?.complete) {
                drawDeviceFrame(ctx, deviceFrame, deviceFrameImg, contentRect);
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

            const renderBorderWidth = borderWidth;

            // --- PASS 1: GLOW ---
            if (hasGlow) {
                ctx.save();
                defineScreenPath(ctx, contentRect, borderRadius);
                ctx.shadowColor = borderColor;
                ctx.shadowBlur = GLOW_BLUR;
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
                defineScreenPath(ctx, contentRect, borderRadius);
                ctx.shadowColor = SHADOW_COLOR;
                ctx.shadowBlur = SHADOW_BLUR;
                ctx.shadowOffsetY = SHADOW_OFFSET_Y;
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
                const urlChanges = project.userEvents?.urlChanges as UrlChangeEvent[] | undefined;
                const sourceTimeMs = currentOutputTimeMs !== undefined && timeMapper
                    ? timeMapper.mapOutputToSourceTime(currentOutputTimeMs)
                    : undefined;
                const toolbarSettings = project.settings.screen.toolbar;
                const addressText = urlChanges && sourceTimeMs !== undefined && sourceTimeMs !== -1
                    ? getUrlAtTime(urlChanges, sourceTimeMs, project.name, toolbarSettings.urlMode)
                    : project.name;

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
                defineScreenPath(ctx, contentRect, borderRadius);
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
