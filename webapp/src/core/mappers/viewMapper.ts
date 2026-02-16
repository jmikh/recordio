import type { Size, Point, Rect } from '../../types';
import { getIntersection } from '../geometry';

export interface MappedPoint extends Point {
    visible: boolean;
}

/**
 * ViewMapper: Maps between Source (input video) coordinates and Output (logical canvas) coordinates.
 * 
 * ## Coordinate Systems
 * - **Source coordinates**: The original video frame pixels (e.g., 3840x2160 capture).
 *   Events like clicks and spotlights are recorded in this coordinate system.
 * - **Output coordinates**: The logical canvas resolution (e.g., 1920x1080).
 *   This is the standardized coordinate system used for rendering and project data.
 * 
 * ## Toolbar Mode (Window Recordings)
 * Window recordings capture the full Chrome window (toolbar + viewport). The `viewportRect`
 * describes where the viewport sits within the video frame, and `toolbarMode` controls
 * how the toolbar region is handled:
 * - **'hide'**: Viewport acts as an effective crop — only the viewport region is rendered.
 * - **'show'**: Full frame is rendered including toolbar.
 * 
 * In both modes, events are recorded in viewport coords and need offset conversion.
 * 
 * Use `eventToOutputPoint` / `eventToOutputRect` / `projectEventToOutput` for event coordinates.
 * Use `sourceToOutputPoint` / `sourceToOutputRect` / `projectSourceToOutput` for frame geometry.
 * 
 * @see DisplayMapper for Output → Display coordinate conversions
 */
export class ViewMapper {
    sourceSize: Size;
    outputSize: Size;
    paddingPercentage: number;
    cropRect?: Rect;
    viewportRect?: Rect;
    toolbarMode: 'show' | 'hide';

    /** Offset to apply to event coordinates to convert from viewport to frame coords */
    private eventOffset: Point;

    /**
     * The rectangle in Output Space where the content (video) is placed.
     * Calculated based on aspect ratio fit and padding.
     */
    public readonly contentRect: Rect;

    constructor(
        sourceSize: Size,
        outputSize: Size,
        paddingPercentage: number,
        cropRect?: Rect,
        viewportRect?: Rect,
        toolbarMode: 'show' | 'hide' = 'hide'
    ) {
        this.outputSize = outputSize;
        this.sourceSize = sourceSize;
        this.paddingPercentage = paddingPercentage;
        this.viewportRect = viewportRect;
        this.toolbarMode = toolbarMode;

        // When hiding toolbar, use viewportRect as an effective crop
        if (toolbarMode === 'hide' && viewportRect) {
            this.cropRect = viewportRect;
        } else {
            this.cropRect = cropRect;
        }

        // Event offset: converts viewport-relative coords to frame coords
        this.eventOffset = viewportRect
            ? { x: viewportRect.x, y: viewportRect.y }
            : { x: 0, y: 0 };

        // Effective size is the Crop Size if it exists, otherwise the full source size
        const effectiveSize = this.cropRect
            ? { width: this.cropRect.width, height: this.cropRect.height }
            : sourceSize;

        // Calculate Scale to fit effective source into output (considering padding)
        const scale = Math.max(
            effectiveSize.width / (this.outputSize.width * (1 - 2 * this.paddingPercentage)),
            effectiveSize.height / (this.outputSize.height * (1 - 2 * this.paddingPercentage))
        );

        // Calculate dimensions of the content in Output Space
        const projectedWidth = effectiveSize.width / scale;
        const projectedHeight = effectiveSize.height / scale;

        const x = (this.outputSize.width - projectedWidth) / 2;
        const y = (this.outputSize.height - projectedHeight) / 2;

        this.contentRect = { x, y, width: projectedWidth, height: projectedHeight };
    }

    // ═══════════════════════════════════════════════════════
    // Frame Geometry Methods (for rendering — no event offset)
    // ═══════════════════════════════════════════════════════

    /**
     * Maps a point from Source Space to Output Space.
     * For frame geometry only — does NOT apply viewport event offset.
     * For event coordinates, use `eventToOutputPoint()`.
     */
    sourceToOutputPoint(point: Point): MappedPoint {
        let effectiveX = point.x;
        let effectiveY = point.y;
        let visible = true;

        const effectiveSize = this.cropRect ? { width: this.cropRect.width, height: this.cropRect.height } : this.sourceSize;
        const offsetX = this.cropRect ? this.cropRect.x : 0;
        const offsetY = this.cropRect ? this.cropRect.y : 0;

        if (this.cropRect) {
            if (point.x < this.cropRect.x || point.x > this.cropRect.x + this.cropRect.width ||
                point.y < this.cropRect.y || point.y > this.cropRect.y + this.cropRect.height) {
                visible = false;
            }

            effectiveX = Math.max(this.cropRect.x, Math.min(point.x, this.cropRect.x + this.cropRect.width));
            effectiveY = Math.max(this.cropRect.y, Math.min(point.y, this.cropRect.y + this.cropRect.height));
        }

        // Normalize relative to Crop (0..1)
        const nx = (effectiveX - offsetX) / effectiveSize.width;
        const ny = (effectiveY - offsetY) / effectiveSize.height;

        // Map to ContentRect in Output Space
        return {
            x: this.contentRect.x + nx * this.contentRect.width,
            y: this.contentRect.y + ny * this.contentRect.height,
            visible
        };
    }

    /**
     * Maps a rectangle from Source Space to Output Space.
     * For frame geometry only. For event rects, use `eventToOutputRect()`.
     */
    sourceToOutputRect(rect: Rect): Rect {
        const p1 = this.sourceToOutputPoint({ x: rect.x, y: rect.y });
        const p2 = this.sourceToOutputPoint({ x: rect.x + rect.width, y: rect.y + rect.height });
        return {
            x: p1.x,
            y: p1.y,
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y)
        };
    }

    /**
     * Projects a source-space rectangle through the viewport to Output coordinates.
     * Combines sourceToOutputPoint with viewport scaling (zoom).
     */
    projectSourceToOutput(rect: Rect, viewport: Rect): Rect {
        const topLeft = this._projectPointToOutput(
            { x: rect.x, y: rect.y }, viewport
        );
        const bottomRight = this._projectPointToOutput(
            { x: rect.x + rect.width, y: rect.y + rect.height }, viewport
        );
        return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y
        };
    }

    // ═══════════════════════════════════════════════════════
    // Event Coordinate Methods (applies viewport offset)
    // ═══════════════════════════════════════════════════════

    /**
     * Maps an event point (viewport-relative) to Output Space.
     * Applies the viewport offset to convert to frame coords first.
     */
    eventToOutputPoint(point: Point): MappedPoint {
        return this.sourceToOutputPoint({
            x: point.x + this.eventOffset.x,
            y: point.y + this.eventOffset.y
        });
    }

    /**
     * Maps an event rectangle (viewport-relative) to Output Space.
     * Applies the viewport offset to convert to frame coords first.
     */
    eventToOutputRect(rect: Rect): Rect {
        return this.sourceToOutputRect({
            x: rect.x + this.eventOffset.x,
            y: rect.y + this.eventOffset.y,
            width: rect.width,
            height: rect.height
        });
    }

    /**
     * Projects an event rectangle (viewport-relative) through the viewport to Output coordinates.
     */
    projectEventToOutput(rect: Rect, viewport: Rect): Rect {
        return this.projectSourceToOutput({
            x: rect.x + this.eventOffset.x,
            y: rect.y + this.eventOffset.y,
            width: rect.width,
            height: rect.height
        }, viewport);
    }

    /**
     * Projects a single event point (viewport-relative) through the viewport to Output coordinates.
     * Used for mouse cursor rendering where a single point is needed.
     */
    projectEventPointToOutput(point: Point, viewport: Rect): MappedPoint {
        return this._projectPointToOutput(
            { x: point.x + this.eventOffset.x, y: point.y + this.eventOffset.y },
            viewport
        );
    }

    // ═══════════════════════════════════════════════════════
    // Rendering Methods
    // ═══════════════════════════════════════════════════════

    /**
     * Calculates the source and destination rectangles for rendering the video 
     * based on the current Viewport (Output Space View).
     */
    resolveRenderRects(viewport: Rect): { sourceRect: Rect, destRect: Rect } | null {
        const intersection = getIntersection(viewport, this.contentRect);

        if (!intersection) {
            return null;
        }

        const effectiveSize = this.cropRect ? { width: this.cropRect.width, height: this.cropRect.height } : this.sourceSize;
        const offsetX = this.cropRect ? this.cropRect.x : 0;
        const offsetY = this.cropRect ? this.cropRect.y : 0;

        const relSrcX = (intersection.x - this.contentRect.x) / this.contentRect.width * effectiveSize.width;
        const relSrcY = (intersection.y - this.contentRect.y) / this.contentRect.height * effectiveSize.height;
        const srcW = (intersection.width / this.contentRect.width) * effectiveSize.width;
        const srcH = (intersection.height / this.contentRect.height) * effectiveSize.height;

        const srcX = relSrcX + offsetX;
        const srcY = relSrcY + offsetY;

        const scaleX = this.outputSize.width / viewport.width;
        const scaleY = this.outputSize.height / viewport.height;

        const dstX = (intersection.x - viewport.x) * scaleX;
        const dstY = (intersection.y - viewport.y) * scaleY;
        const dstW = intersection.width * scaleX;
        const dstH = intersection.height * scaleY;

        return {
            sourceRect: { x: srcX, y: srcY, width: srcW, height: srcH },
            destRect: { x: dstX, y: dstY, width: dstW, height: dstH }
        };
    }

    /**
     * Returns the zoom scale factor relative to the Output Size.
     * Scale 1.0 = Viewport is exactly the Output Size.
     * Scale 2.0 = Viewport is half the Output Size (Zoomed In).
     */
    getZoomScale(viewport: Rect): number {
        return this.outputSize.width / viewport.width;
    }

    /**
     * Returns the projected rectangle of the "Subject" (effective source) on the output.
     * "Subject" is the Crop Rect if defined, otherwise the Full Source.
     * This represents the area that visual elements (borders, shadows) should wrap around.
     */
    getProjectedSubjectRect(viewport: Rect): Rect {
        const subjectRect = this.cropRect
            ? { x: this.cropRect.x, y: this.cropRect.y, width: this.cropRect.width, height: this.cropRect.height }
            : { x: 0, y: 0, width: this.sourceSize.width, height: this.sourceSize.height };

        return this.projectSourceToOutput(subjectRect, viewport);
    }

    // ═══════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════

    /**
     * Projects a single source-space point through the viewport to Output coordinates.
     */
    private _projectPointToOutput(point: Point, viewport: Rect): MappedPoint {
        const outputPoint = this.sourceToOutputPoint(point);

        const scaleX = this.outputSize.width / viewport.width;
        const scaleY = this.outputSize.height / viewport.height;

        return {
            x: (outputPoint.x - viewport.x) * scaleX,
            y: (outputPoint.y - viewport.y) * scaleY,
            visible: outputPoint.visible
        };
    }
}
