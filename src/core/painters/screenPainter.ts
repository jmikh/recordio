import type { UserEvents, Project, TimeMs, ID, SourceMetadata, Rect } from '../types';
import { ViewMapper } from '../viewMapper';
import { paintMouseClicks } from './mouseClickPainter';
import { drawDragEffects } from './mouseDragPainter';
import { getDeviceFrame } from '../deviceFrames';

/**
 * Draws the screen recording frame.
 * Encapsulates logic for viewport calculation and event lookup.
 */
export function drawScreen(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    project: Project,
    sources: Record<ID, SourceMetadata>,
    userEvents: UserEvents | null,
    currentTimeMs: TimeMs,
    effectiveViewport: Rect // Injected from caller
) {
    const { timeline } = project;
    const { recording } = timeline;

    // 1. Resolve Data
    const screenSource = sources[recording.screenSourceId];
    if (!screenSource) return;

    // 2. Calculate Times
    // Source Time: time relative to the video file
    const sourceTimeMs = currentTimeMs - recording.timelineOffsetMs;
    // Output Time logic removed as it was only for viewport calc

    // Use video dimensions if available, otherwise source metadata
    // Note: Video dimensions might be 0 if not loaded, fallback to metadata size
    const inputSize = video.videoWidth && video.videoHeight
        ? { width: video.videoWidth, height: video.videoHeight }
        : screenSource.size;

    if (!inputSize || inputSize.width === 0) return;

    // 4. Resolve View Mapping
    const outputSize = project.settings.outputSize;
    const padding = project.settings.padding;
    const viewMapper = new ViewMapper(inputSize, outputSize, padding);

    // 5. Draw Video
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

        // 6. Draw Mouse Effects Overlay
        if (userEvents) {
            // These painters use Source Time because events are recorded in Source Time
            if (userEvents.mouseClicks) {
                paintMouseClicks(ctx, userEvents.mouseClicks, sourceTimeMs, effectiveViewport, viewMapper);
            }
            if (userEvents.drags) {
                drawDragEffects(ctx, userEvents.drags, sourceTimeMs, effectiveViewport, viewMapper);
            }
        }

        ctx.restore();

        // ============================
        // DRAW DEVICE FRAME (Overlay)
        // ============================
        // Drawn AFTER restore ensures it is:
        // 1. On Top of Video (Notch covers video)
        // 2. Unclipped (Bezel extends outside)
        const deviceFrame = getDeviceFrame(project.settings.deviceFrameId);
        if (deviceFrame) {
            // Calculate where the Top-Left and Bottom-Right of the FULL video would be on the canvas
            const topLeft = viewMapper.projectToScreen({ x: 0, y: 0 }, effectiveViewport);
            const bottomRight = viewMapper.projectToScreen({ x: inputSize.width, y: inputSize.height }, effectiveViewport);

            const videoScreenW = bottomRight.x - topLeft.x;
            const videoScreenH = bottomRight.y - topLeft.y;

            const b = deviceFrame.borderData;

            // Current Video is the "Hole". Frame expands outwards.
            // Video W = Total W * (1 - left% - right%)
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
}
