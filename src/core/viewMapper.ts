import type { Size, Point, Rect } from './types';

export interface MappedPoint extends Point {
    visible: boolean;
}

/**
 * ViewMapper: Maps between Source (input video) coordinates and Output (logical canvas) coordinates.
 * 
 * ## Purpose
 * ViewMapper handles the transformation from the original video frame (Source) to the
 * logical output canvas (Output), accounting for cropping, aspect ratio fitting, and padding.
 * 
 * ## Coordinate Systems
 * - **Source coordinates**: The original video frame pixels (e.g., 3840x2160 capture).
 *   Events like clicks and spotlights are recorded in this coordinate system.
 * - **Output coordinates**: The logical canvas resolution (e.g., 1920x1080).
 *   This is the standardized coordinate system used for rendering and project data.
 * 
 * ## When to Use
 * - Recording: Converting captured event positions to output coordinates
 * - Spotlights: Mapping spotlight source rects to output rects
 * - Video rendering: Calculating source/dest rects for drawImage
 * - Coordinate normalization: Converting between input and output spaces
 * 
 * ## Relationship to DisplayMapper
 * - ViewMapper: Source → Output (handles cropping, aspect ratio, padding)
 * - DisplayMapper: Output → Display (handles scale for CSS/DOM rendering)
 * 
 * These can be chained: Source → ViewMapper → Output → DisplayMapper → Display
 * 
 * @see DisplayMapper for Output → Display coordinate conversions
 */
export class ViewMapper {
    inputVideoSize: Size;
    outputVideoSize: Size;
    paddingPercentage: number;
    cropRect?: Rect;

    /**
     * The rectangle in Output Space where the content (video) is placed.
     * Calculated based on aspect ratio fit and padding.
     */
    public readonly contentRect: Rect;

    constructor(
        inputVideoSize: Size,
        outputVideoSize: Size,
        paddingPercentage: number,
        cropRect?: Rect
    ) {
        this.outputVideoSize = outputVideoSize;
        this.inputVideoSize = inputVideoSize;
        this.paddingPercentage = paddingPercentage;
        this.cropRect = cropRect;

        // Effective Input Size is the Crop Size if it exists, otherwise the full video size
        const effectiveInputSize = cropRect ? { width: cropRect.width, height: cropRect.height } : inputVideoSize;

        // Calculate Scale to fit effective input into output (considering padding)
        const scale = Math.max(
            effectiveInputSize.width / (this.outputVideoSize.width * (1 - 2 * this.paddingPercentage)),
            effectiveInputSize.height / (this.outputVideoSize.height * (1 - 2 * this.paddingPercentage))
        );

        // Calculate dimensions of the content in Output Space
        const projectedWidth = effectiveInputSize.width / scale;
        const projectedHeight = effectiveInputSize.height / scale;

        const x = (this.outputVideoSize.width - projectedWidth) / 2;
        const y = (this.outputVideoSize.height - projectedHeight) / 2;

        this.contentRect = { x, y, width: projectedWidth, height: projectedHeight };
    }

    /**
     * Maps a point from Input Space (Source Video) to Output Space (Canvas).
     * Handles cropping by clamping to the crop area.
     */
    inputToOutputPoint(point: Point): MappedPoint {
        let effectiveX = point.x;
        let effectiveY = point.y;
        let visible = true;

        const effectiveInputSize = this.cropRect ? { width: this.cropRect.width, height: this.cropRect.height } : this.inputVideoSize;
        const offsetX = this.cropRect ? this.cropRect.x : 0;
        const offsetY = this.cropRect ? this.cropRect.y : 0;

        if (this.cropRect) {
            // Check visibility using the original point
            if (point.x < this.cropRect.x || point.x > this.cropRect.x + this.cropRect.width ||
                point.y < this.cropRect.y || point.y > this.cropRect.y + this.cropRect.height) {
                visible = false;
            }

            // Clamp to Crop Rect
            effectiveX = Math.max(this.cropRect.x, Math.min(point.x, this.cropRect.x + this.cropRect.width));
            effectiveY = Math.max(this.cropRect.y, Math.min(point.y, this.cropRect.y + this.cropRect.height));
        }

        // Normalize relative to Crop (0..1)
        const nx = (effectiveX - offsetX) / effectiveInputSize.width;
        const ny = (effectiveY - offsetY) / effectiveInputSize.height;

        // Map to ContentRect in Output Space
        return {
            x: this.contentRect.x + nx * this.contentRect.width,
            y: this.contentRect.y + ny * this.contentRect.height,
            visible
        };
    }

    /**
     * Maps a rectangle from Input Space to Output Space.
     */
    inputToOutputRect(rect: Rect): Rect {
        const p1 = this.inputToOutputPoint({ x: rect.x, y: rect.y });
        const p2 = this.inputToOutputPoint({ x: rect.x + rect.width, y: rect.y + rect.height });
        return {
            x: p1.x,
            y: p1.y,
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y)
        };
    }

    /**
     * Calculates the source and destination rectangles for rendering the video 
     * based on the current Viewport (Output Space View).
     * 
     * @param viewport The current visible window in Output Space.
     */
    resolveRenderRects(viewport: Rect): { sourceRect: Rect, destRect: Rect } | null {
        // 1. Find Intersection of Viewport and ContentRect
        // This is the part of the Content visible in the Viewport
        const intersection = getIntersection(viewport, this.contentRect);

        if (!intersection) {
            return null; // Viewport is looking entirely at padding/background
        }

        const effectiveInputSize = this.cropRect ? { width: this.cropRect.width, height: this.cropRect.height } : this.inputVideoSize;
        const offsetX = this.cropRect ? this.cropRect.x : 0;
        const offsetY = this.cropRect ? this.cropRect.y : 0;

        // 2. Calculate sourceRect (Relative to Effective Input Space --> Then add offset)
        // Map intersection (Output Space) -> Relative Input Space
        const relSrcX = (intersection.x - this.contentRect.x) / this.contentRect.width * effectiveInputSize.width;
        const relSrcY = (intersection.y - this.contentRect.y) / this.contentRect.height * effectiveInputSize.height;
        const srcW = (intersection.width / this.contentRect.width) * effectiveInputSize.width;
        const srcH = (intersection.height / this.contentRect.height) * effectiveInputSize.height;

        // Add Crop Offset to get actual Source Coordinates
        const srcX = relSrcX + offsetX;
        const srcY = relSrcY + offsetY;


        // 3. Calculate destRect (Canvas/Screen Drawing Coordinates)
        // Map the visible intersection relative to the Viewport
        // Scaling factor: Output Size / Viewport Size
        const scaleX = this.outputVideoSize.width / viewport.width;
        const scaleY = this.outputVideoSize.height / viewport.height;

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
     * Maps a point from Input Space -> Screen Coordinates (pixels on the final canvas).
     */
    projectToScreen(point: Point, viewport: Rect): MappedPoint {
        // 1. Input -> Output Space
        const outputPoint = this.inputToOutputPoint(point);

        // 2. Output Space -> Screen (Relative to Viewport)
        // (p - cam.x) * scale
        const scaleX = this.outputVideoSize.width / viewport.width;
        const scaleY = this.outputVideoSize.height / viewport.height;

        return {
            x: (outputPoint.x - viewport.x) * scaleX,
            y: (outputPoint.y - viewport.y) * scaleY,
            visible: outputPoint.visible
        };
    }

    /**
     * Returns the zoom scale factor relative to the Output Video Size.
     * Scale 1.0 means the Viewport is exactly the Output Video Size.
     * Scale 2.0 means the Viewport is half the Output Video Size (Zoomed In).
     */
    getZoomScale(viewport: Rect): number {
        // We assume uniform scaling for zoom elements, so we use width ratio.
        return this.outputVideoSize.width / viewport.width;
    }

    /**
     * Returns the projected rectangle of the "Subject" (effective input) on the screen.
     * "Subject" is the Crop Rect if defined, otherwise the Full Input Video.
     * This represents the area that visual elements (borders, shadows) should wrap around.
     */
    getProjectedSubjectRect(viewport: Rect): Rect {
        const effectiveInputSize = this.cropRect
            ? { width: this.cropRect.width, height: this.cropRect.height }
            : this.inputVideoSize;
        const offsetX = this.cropRect ? this.cropRect.x : 0;
        const offsetY = this.cropRect ? this.cropRect.y : 0;

        // Get corners in Input Space
        const topLeftInput = { x: offsetX, y: offsetY };
        const bottomRightInput = { x: offsetX + effectiveInputSize.width, y: offsetY + effectiveInputSize.height };

        // Project to Screen Space
        const topLeftScreen = this.projectToScreen(topLeftInput, viewport);
        const bottomRightScreen = this.projectToScreen(bottomRightInput, viewport);

        return {
            x: topLeftScreen.x,
            y: topLeftScreen.y,
            width: bottomRightScreen.x - topLeftScreen.x,
            height: bottomRightScreen.y - topLeftScreen.y
        };
    }
}

// Helper
function getIntersection(r1: Rect, r2: Rect): Rect | null {
    const x = Math.max(r1.x, r2.x);
    const y = Math.max(r1.y, r2.y);
    const width = Math.min(r1.x + r1.width, r2.x + r2.width) - x;
    const height = Math.min(r1.y + r1.height, r2.y + r2.height) - y;

    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}
