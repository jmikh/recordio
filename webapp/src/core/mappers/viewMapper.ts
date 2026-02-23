import type { Size, Point, Rect } from '../../types';
import type { DeviceFrame } from '../../types/deviceFrames';
import { getIntersection } from '../geometry';
import { resolveScreenRect } from '../painters/smartFramePainter';

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
 * ## Layout Modes
 * 
 * ### Border Mode (default)
 * Padding shrinks the available area for the screen content. The screen is centered in the output.
 * 
 * ### Device Frame Mode (when `deviceFrame` is provided)
 * Padding shrinks the available area for the **frame** (not the screen).
 * The frame stretches to match the video's aspect ratio (9-slice handles visual stretching).
 * The screen's contentRect is derived from the frame's screenRect proportions, so it may
 * be off-center (e.g., MacBook has a thick bottom bezel).
 * 
 * ## Toolbar (Window Recordings)
 * Window recordings capture the full Chrome window (toolbar + content area). The `trackableContentRect`
 * describes where the JavaScript-trackable content sits within the video frame, and `toolbarEnabled`
 * controls whether a custom branded toolbar is drawn above the content:
 * - **enabled=true**: The user's crop is respected, but if it doesn't fully exclude the
 *   native toolbar area (above trackableContentRect.y), the effective crop is clamped to exclude it.
 *   A custom branded toolbar is drawn on top of the content.
 * - **enabled=false**: The user's crop is used as-is. No toolbar is drawn.
 *
 * In both cases, events are recorded in content area coords and need offset conversion.
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
    trackableContentRect?: Rect;
    toolbarEnabled: boolean;

    /** Precomputed: effective source dimensions (crop or full source) */
    private readonly effectiveSize: Size;

    /** Precomputed: offset to apply when mapping from effective coords to full source coords */
    private readonly cropOffset: Point;

    /** Offset to apply to event coordinates to convert from viewport to frame coords */
    private readonly eventOffset: Point;

    /**
     * The rectangle in Output Space where the video content is placed.
     * In device frame mode, derived from the frame's screenRect.
     * In border mode, centered in the padded output area.
     */
    public readonly contentRect: Rect;

    /**
     * The rectangle in Output Space where the device frame image should be drawn.
     * Only set when a deviceFrame is provided.
     */
    public readonly frameRect?: Rect;

    /**
     * Height of the custom toolbar in Output Space (0 when no toolbar).
     * The toolbar sits directly above contentRect.
     */
    public readonly toolbarOutputHeight: number;

    /** Toolbar height as a fraction of source viewport height */
    private static readonly TOOLBAR_HEIGHT_RATIO = 0.05;

    constructor(
        sourceSize: Size,
        outputSize: Size,
        paddingPercentage: number,
        cropRect?: Rect,
        trackableContentRect?: Rect,
        toolbarEnabled: boolean = true,
        deviceFrame?: DeviceFrame
    ) {
        this.outputSize = outputSize;
        this.sourceSize = sourceSize;
        this.paddingPercentage = paddingPercentage;
        this.trackableContentRect = trackableContentRect;
        this.toolbarEnabled = toolbarEnabled;

        // ── Step 1: Resolve effective crop ──────────────────────────────
        // When toolbar is enabled, clamp crop top to exclude native toolbar area.
        if (toolbarEnabled && trackableContentRect) {
            const baseCrop = cropRect ?? { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };

            if (baseCrop.y < trackableContentRect.y) {
                const clippedTop = trackableContentRect.y;
                this.cropRect = {
                    x: baseCrop.x,
                    y: clippedTop,
                    width: baseCrop.width,
                    height: baseCrop.height - (clippedTop - baseCrop.y)
                };
            } else {
                this.cropRect = baseCrop;
            }
        } else {
            this.cropRect = cropRect;
        }

        // ── Step 2: Precompute shared values ───────────────────────────
        this.effectiveSize = this.cropRect
            ? { width: this.cropRect.width, height: this.cropRect.height }
            : sourceSize;

        this.cropOffset = this.cropRect
            ? { x: this.cropRect.x, y: this.cropRect.y }
            : { x: 0, y: 0 };

        this.eventOffset = trackableContentRect
            ? { x: trackableContentRect.x, y: trackableContentRect.y }
            : { x: 0, y: 0 };

        // ── Step 3: Compute toolbar + total content height ─────────────
        const hasCustomToolbar = toolbarEnabled && !!trackableContentRect;
        const toolbarSourceH = hasCustomToolbar
            ? trackableContentRect.height * ViewMapper.TOOLBAR_HEIGHT_RATIO
            : 0;
        const totalSourceH = this.effectiveSize.height + toolbarSourceH;

        // ── Step 4: Compute layout (mode-specific) ─────────────────────
        // Both modes produce: contentRect, toolbarOutputHeight, and optionally frameRect.
        // The padded area is the region available after applying padding.
        const paddedW = outputSize.width * (1 - 2 * paddingPercentage);
        const paddedH = outputSize.height * (1 - 2 * paddingPercentage);

        if (deviceFrame) {
            // ════════════════════════════════════════════════════════════
            // DEVICE FRAME MODE
            //
            // All frames use 9-slice rendering, which stretches scalable
            // regions differently from fixed regions. We can't use a simple
            // formula to predict where the screen area ends up — instead,
            // we use resolveScreenRect (same math as the 9-slice renderer)
            // to find the frame aspect ratio that produces a screen area
            // matching the video's aspect ratio.
            // ════════════════════════════════════════════════════════════

            const sr = deviceFrame.screenRect;
            const videoAspect = this.effectiveSize.width / totalSourceH;

            // Binary search for the frameAspect where the 9-slice-computed
            // screen area matches videoAspect. ~20 iterations → precision < 0.001%.
            const naturalAspect = deviceFrame.size.width / deviceFrame.size.height;
            let lo = naturalAspect * 0.3;
            let hi = naturalAspect * 3.0;

            for (let i = 0; i < 25; i++) {
                const mid = (lo + hi) / 2;
                const testFrame = ViewMapper._fitAndCenter(mid, paddedW, paddedH, outputSize);
                const screen = resolveScreenRect(sr, deviceFrame.size, testFrame.rect, deviceFrame.customScaling);
                const screenAspect = screen.width / screen.height;
                if (screenAspect < videoAspect) {
                    lo = mid; // Need wider frame → wider screen
                } else {
                    hi = mid;
                }
            }

            const frameAspect = (lo + hi) / 2;
            const { rect: frame } = ViewMapper._fitAndCenter(frameAspect, paddedW, paddedH, outputSize);
            this.frameRect = frame;

            // Use resolveScreenRect to get the exact screen position
            // (same math as the 9-slice renderer — pixel-perfect alignment)
            const screen = resolveScreenRect(sr, deviceFrame.size, frame, deviceFrame.customScaling);
            const screenX = screen.x;
            const screenY = screen.y;
            const screenW = screen.width;
            const screenH = screen.height;

            // Split video area into toolbar + content
            const contentRatio = this.effectiveSize.height / totalSourceH;
            const projectedContentH = screenH * contentRatio;
            this.toolbarOutputHeight = screenH - projectedContentH;

            this.contentRect = {
                x: screenX,
                y: screenY + this.toolbarOutputHeight,
                width: screenW,
                height: projectedContentH
            };

        } else {
            // ════════════════════════════════════════════════════════════
            // BORDER MODE — padding applies to the screen directly
            // ════════════════════════════════════════════════════════════
            const videoAspect = this.effectiveSize.width / totalSourceH;

            const { rect: fitted } = ViewMapper._fitAndCenter(
                videoAspect, paddedW, paddedH, outputSize
            );

            // Split fitted area into toolbar + content
            const contentRatio = this.effectiveSize.height / totalSourceH;
            const projectedContentH = fitted.height * contentRatio;
            this.toolbarOutputHeight = fitted.height - projectedContentH;

            this.contentRect = {
                x: fitted.x,
                y: fitted.y + this.toolbarOutputHeight,
                width: fitted.width,
                height: projectedContentH
            };
        }
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

        if (this.cropRect) {
            if (point.x < this.cropRect.x || point.x > this.cropRect.x + this.cropRect.width ||
                point.y < this.cropRect.y || point.y > this.cropRect.y + this.cropRect.height) {
                visible = false;
            }

            effectiveX = Math.max(this.cropRect.x, Math.min(point.x, this.cropRect.x + this.cropRect.width));
            effectiveY = Math.max(this.cropRect.y, Math.min(point.y, this.cropRect.y + this.cropRect.height));
        }

        // Normalize relative to effective area (0..1)
        const nx = (effectiveX - this.cropOffset.x) / this.effectiveSize.width;
        const ny = (effectiveY - this.cropOffset.y) / this.effectiveSize.height;

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
        if (!intersection) return null;

        const relSrcX = (intersection.x - this.contentRect.x) / this.contentRect.width * this.effectiveSize.width;
        const relSrcY = (intersection.y - this.contentRect.y) / this.contentRect.height * this.effectiveSize.height;
        const srcW = (intersection.width / this.contentRect.width) * this.effectiveSize.width;
        const srcH = (intersection.height / this.contentRect.height) * this.effectiveSize.height;

        const scaleX = this.outputSize.width / viewport.width;
        const scaleY = this.outputSize.height / viewport.height;

        return {
            sourceRect: {
                x: relSrcX + this.cropOffset.x,
                y: relSrcY + this.cropOffset.y,
                width: srcW,
                height: srcH
            },
            destRect: {
                x: (intersection.x - viewport.x) * scaleX,
                y: (intersection.y - viewport.y) * scaleY,
                width: intersection.width * scaleX,
                height: intersection.height * scaleY
            }
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

    /**
     * Returns the frameRect projected through the viewport (zoom-aware).
     * Applies the same zoom transform used for screen content positioning.
     * Returns undefined if no device frame is set.
     */
    getProjectedFrameRect(viewport: Rect): Rect | undefined {
        if (!this.frameRect) return undefined;
        return this._projectRectToViewport(this.frameRect, viewport);
    }

    // ═══════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════

    /**
     * Fits a rectangle with the given aspect ratio into the available area,
     * then centers it in the full output. Shared by both layout modes.
     */
    private static _fitAndCenter(
        aspect: number,
        availableW: number,
        availableH: number,
        outputSize: Size
    ): { rect: Rect; innerScale: number } {
        let w: number, h: number;
        if (aspect > availableW / availableH) {
            w = availableW;
            h = availableW / aspect;
        } else {
            h = availableH;
            w = availableH * aspect;
        }

        return {
            rect: {
                x: (outputSize.width - w) / 2,
                y: (outputSize.height - h) / 2,
                width: w,
                height: h
            },
            innerScale: 0 // unused for border mode
        };
    }

    /**
     * Projects an output-space rect through a viewport (zoom transform).
     */
    private _projectRectToViewport(rect: Rect, viewport: Rect): Rect {
        const scaleX = this.outputSize.width / viewport.width;
        const scaleY = this.outputSize.height / viewport.height;
        return {
            x: (rect.x - viewport.x) * scaleX,
            y: (rect.y - viewport.y) * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY
        };
    }

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
