import type { Project, Rect } from '../types';
import { ViewMapper } from '../mappers/viewMapper';
import { getDeviceFrame } from '../deviceFrames';
import { drawDeviceFrame } from './smartFramePainter';

const SHADOW_BLUR = 20;
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const SHADOW_OFFSET_Y = 10;
const GLOW_BLUR = 25;

/**
 * Helper to define the rounded path for the FULL screen content.
 */
function defineScreenPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number
) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
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
    deviceFrameImg: HTMLImageElement | null // Cached device frame image
): { viewMapper: ViewMapper } {
    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadius: 12,
        borderWidth: 0,
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
    const viewMapper = new ViewMapper(inputSize, outputSize, padding, project.settings.screen.crop);

    // 4. Calculate Rects
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);

    if (renderRects) {
        // Calculate Scale Factor (Canvas Pixels per Source Pixel)
        const scale = renderRects.destRect.width / renderRects.sourceRect.width;

        // Calculate Project Rect (Full Video on Canvas)
        // Calculate Project Rect (Logical Screen on Canvas)
        const logicalScreenRect = viewMapper.getProjectedSubjectRect(effectiveViewport);
        const originX = logicalScreenRect.x;
        const originY = logicalScreenRect.y;
        const projectedW = logicalScreenRect.width;
        const projectedH = logicalScreenRect.height;

        const isDeviceMode = screenConfig.mode === 'device';

        ctx.save();

        if (isDeviceMode) {
            // ============================
            // MODE: DEVICE FRAME
            // ============================

            // Just draw video directly (no clipping/rounding, frame covers edges)
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );

            // Draw Device Frame Overlay
            const deviceFrame = getDeviceFrame(screenConfig.deviceFrameId);
            if (deviceFrame && deviceFrameImg?.complete) {
                // Calculate video screen bounds in canvas coordinates
                const topLeft = viewMapper.projectToScreen({ x: 0, y: 0 }, effectiveViewport);
                const bottomRight = viewMapper.projectToScreen({ x: inputSize.width, y: inputSize.height }, effectiveViewport);

                drawDeviceFrame(ctx, deviceFrame, deviceFrameImg, {
                    x: topLeft.x,
                    y: topLeft.y,
                    width: bottomRight.x - topLeft.x,
                    height: bottomRight.y - topLeft.y
                });
            }

        } else {
            // ============================
            // MODE: BORDER / CUSTOM
            // ============================
            const {
                borderRadius = 0,
                borderWidth = 0,
                borderColor = '#ffffff',
                hasShadow = false,
                hasGlow = false
            } = screenConfig;

            const scaledRadius = borderRadius * scale;
            // const scaledBorder = borderWidth * scale; // Scale border thickness too? Usually better fixed?
            // Actually, for consistency with Camera, border is fixed pixels. But here we are zooming.
            // If I zoom in, the border should look the same thickness relative to the screen?
            // In Figma, if you zoom, border scales.
            // But usually UI borders are defined in "logical" pixels.
            // Let's assume passed borderWidth is in logical pixels (at 100%).
            // But CameraSettings borderWidth is pixels on canvas (absolute).
            // Let's keep it simple: Use constant borderWidth (pixels on canvas).
            const renderBorderWidth = borderWidth;

            // --- PASS 1: GLOW ---
            if (hasGlow) {
                ctx.save();
                defineScreenPath(ctx, originX, originY, projectedW, projectedH, scaledRadius);
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
                defineScreenPath(ctx, originX, originY, projectedW, projectedH, scaledRadius);
                ctx.shadowColor = SHADOW_COLOR;
                ctx.shadowBlur = SHADOW_BLUR;
                ctx.shadowOffsetY = SHADOW_OFFSET_Y;
                ctx.fillStyle = 'black'; // Shadow caster color
                ctx.fill();

                if (renderBorderWidth > 0) {
                    ctx.lineWidth = renderBorderWidth;
                    ctx.strokeStyle = 'black';
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- PASS 3: VIDEO CONTENT (Clipped) ---
            ctx.save();
            defineScreenPath(ctx, originX, originY, projectedW, projectedH, scaledRadius);
            ctx.clip();
            ctx.drawImage(
                video,
                renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
                renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
            );
            ctx.restore();

            // --- PASS 4: BORDER ---
            if (renderBorderWidth > 0) {
                ctx.save();
                defineScreenPath(ctx, originX, originY, projectedW, projectedH, scaledRadius);
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
