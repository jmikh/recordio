import type { Project, ID, SourceMetadata, Rect } from '../types';
import { ViewMapper } from '../viewMapper';
import { getDeviceFrame } from '../deviceFrames';
import { drawSmartFrame } from './smartFramePainter';

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
    sources: Record<ID, SourceMetadata>,
    effectiveViewport: Rect // Injected from caller
): { viewMapper: ViewMapper } {
    const { timeline } = project;
    const { recording } = timeline;

    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadius: 12,
        borderWidth: 0,
        borderColor: '#ffffff',
        hasShadow: true,
        hasGlow: false
    };

    // 1. Resolve Data
    const screenSource = sources[recording.screenSourceId];
    if (!screenSource) {
        throw new Error(`[drawScreen] Screen source not found: ${recording.screenSourceId}`);
    }

    // 2. Use video dimensions if available, otherwise source metadata
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : screenSource.size;

    if (!inputSize || inputSize.width === 0) {
        throw new Error(`[drawScreen] Invalid inputSize for source ${screenSource.id}.`);
    }

    // 3. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.padding;
    const viewMapper = new ViewMapper(inputSize, outputSize, padding);

    // 4. Calculate Rects
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);

    if (renderRects) {
        // Calculate Scale Factor (Canvas Pixels per Source Pixel)
        const scale = renderRects.destRect.width / renderRects.sourceRect.width;

        // Calculate Project Rect (Full Video on Canvas)
        const originX = renderRects.destRect.x - (renderRects.sourceRect.x * scale);
        const originY = renderRects.destRect.y - (renderRects.sourceRect.y * scale);
        const projectedW = inputSize.width * scale;
        const projectedH = inputSize.height * scale;

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
            if (deviceFrame) {
                // Calculate corners in screen space (viewport relative)
                // Note: The viewMapper implementation needs to project relative to viewport
                const topLeft = viewMapper.projectToScreen({ x: 0, y: 0 }, effectiveViewport);
                const bottomRight = viewMapper.projectToScreen({ x: inputSize.width, y: inputSize.height }, effectiveViewport);

                const videoScreenW = bottomRight.x - topLeft.x;
                const videoScreenH = bottomRight.y - topLeft.y;

                const b = deviceFrame.borderData;
                let frameW: number, frameH: number, frameX: number, frameY: number;

                if (deviceFrame.customScaling) {
                    const srcScreenW = deviceFrame.screenRect.width;
                    const srcScreenH = deviceFrame.screenRect.height;
                    const srcBezelLeft = deviceFrame.screenRect.x;
                    const srcBezelTop = deviceFrame.screenRect.y;
                    const srcBezelRight = deviceFrame.size.width - (srcBezelLeft + srcScreenW);
                    const srcBezelBottom = deviceFrame.size.height - (srcBezelTop + srcScreenH);

                    const scaleScreenW = videoScreenW / srcScreenW;
                    const scaleScreenH = videoScreenH / srcScreenH;
                    const baseScale = Math.min(scaleScreenW, scaleScreenH);

                    frameW = videoScreenW + (srcBezelLeft + srcBezelRight) * baseScale;
                    frameH = videoScreenH + (srcBezelTop + srcBezelBottom) * baseScale;
                    frameX = topLeft.x - (srcBezelLeft * baseScale);
                    frameY = topLeft.y - (srcBezelTop * baseScale);
                } else {
                    frameW = videoScreenW / (1 - b.left - b.right);
                    frameH = videoScreenH / (1 - b.top - b.bottom);
                    frameX = topLeft.x - (frameW * b.left);
                    frameY = topLeft.y - (frameH * b.top);
                }

                const img = new Image();
                img.src = deviceFrame.imageUrl;
                if (img.complete) {
                    ctx.imageSmoothingQuality = 'high';
                    if (deviceFrame.customScaling) {
                        drawSmartFrame(ctx, img, frameX, frameY, frameW, frameH, deviceFrame.customScaling);
                    } else {
                        ctx.drawImage(img, frameX, frameY, frameW, frameH);
                    }
                } else {
                    img.onload = () => { };
                }
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
