import type { Project, ID, SourceMetadata, Rect } from '../types';
import { ViewMapper } from '../viewMapper';
import { getDeviceFrame } from '../deviceFrames';

// ... imports ...

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

    // 1. Resolve Data
    const screenSource = sources[recording.screenSourceId];
    if (!screenSource) {
        throw new Error(`[drawScreen] Screen source not found: ${recording.screenSourceId}`);
    }

    // 2. Calculate Times
    // Source Time: time relative to the video file
    // 2. Calculate Times
    // Source Time removed from here as it is only needed for events now


    // Use video dimensions if available, otherwise source metadata
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : screenSource.size;

    if (!inputSize || inputSize.width === 0) {
        throw new Error(`[drawScreen] Invalid inputSize for source ${screenSource.id}. Video: ${video.videoWidth}x${video.videoHeight}, Metadata: ${JSON.stringify(screenSource.size)}`);
    }

    // 4. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.padding;
    const viewMapper = new ViewMapper(inputSize, outputSize, padding);

    // 5. Draw Video & Effects
    const renderRects = viewMapper.resolveRenderRects(effectiveViewport);
    if (renderRects) {
        ctx.save();

        // Calculate Scale Factor (Canvas Pixels per Source Pixel)
        const scale = renderRects.destRect.width / renderRects.sourceRect.width;

        // Apply Corner Radius Clip (Projected to Canvas Space)
        if (project.settings.cornerRadius && project.settings.cornerRadius > 0) {
            // Calculate where the Top-Left of the FULL video would be on the canvas
            const originX = renderRects.destRect.x - (renderRects.sourceRect.x * scale);
            const originY = renderRects.destRect.y - (renderRects.sourceRect.y * scale);

            // Calculate dimensions of the FULL video on the canvas
            const projectedW = inputSize.width * scale;
            const projectedH = inputSize.height * scale;

            // Scale the radius so it stays "attached" to the video size
            const scaledRadius = project.settings.cornerRadius * scale;

            ctx.beginPath();
            ctx.roundRect(
                originX,
                originY,
                projectedW,
                projectedH,
                scaledRadius
            );
            ctx.clip();
        }

        ctx.drawImage(
            video,
            renderRects.sourceRect.x, renderRects.sourceRect.y, renderRects.sourceRect.width, renderRects.sourceRect.height,
            renderRects.destRect.x, renderRects.destRect.y, renderRects.destRect.width, renderRects.destRect.height
        );

        ctx.restore();

        // ============================
        // DRAW DEVICE FRAME (Overlay)
        // ============================
        const deviceFrame = getDeviceFrame(project.settings.deviceFrameId);
        if (deviceFrame) {
            const topLeft = viewMapper.projectToScreen({ x: 0, y: 0 }, effectiveViewport);
            const bottomRight = viewMapper.projectToScreen({ x: inputSize.width, y: inputSize.height }, effectiveViewport);

            const videoScreenW = bottomRight.x - topLeft.x;
            const videoScreenH = bottomRight.y - topLeft.y;

            const b = deviceFrame.borderData;

            const frameW = videoScreenW / (1 - b.left - b.right);
            const frameH = videoScreenH / (1 - b.top - b.bottom);

            const frameX = topLeft.x - (frameW * b.left);
            const frameY = topLeft.y - (frameH * b.top);

            const img = new Image();
            img.src = deviceFrame.imageUrl;

            if (img.complete) {
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, frameX, frameY, frameW, frameH);
            } else {
                img.onload = () => { };
            }
        }
    }

    return { viewMapper };
}
