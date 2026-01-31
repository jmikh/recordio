import type { Rect, Size } from '../types';

/**
 * Per-corner border radius tuple [topLeft, topRight, bottomRight, bottomLeft].
 * Values are in the coordinate system of the context they're used in.
 */
export type CornerRadii = [number, number, number, number];

/**
 * DisplayMapper: Maps between Output coordinates and Display (CSS/DOM) coordinates.
 * 
 * ## Purpose
 * While ViewMapper handles the transformation between Source (input video) coordinates
 * and Output (logical canvas) coordinates, DisplayMapper handles the final transformation
 * from Output coordinates to the actual rendered Display/CSS coordinates.
 * 
 * ## Coordinate Systems
 * - **Output coordinates**: The logical canvas resolution (e.g., 1920x1080).
 *   This is the coordinate system used by spotlights, zooms, and other project elements.
 * - **Display coordinates**: The actual rendered size on screen (e.g., 640x360 in the editor).
 *   This is what CSS/DOM elements use for positioning and sizing.
 * 
 * ## When to Use
 * - BoundingBox: Converting output rects to CSS positioning
 * - DimmedOverlay: Positioning the SVG mask hole
 * - Editor overlays: Any UI element that needs to align with the canvas
 * - Border radius conversions: Scaling radii from output to display units
 * 
 * ## Relationship to ViewMapper
 * - ViewMapper: Source → Output (handles cropping, aspect ratio, padding)
 * - DisplayMapper: Output → Display (handles scale for rendering)
 * 
 * These can be chained: Source → ViewMapper → Output → DisplayMapper → Display
 */
export class DisplayMapper {
    /** The logical output resolution (e.g., 1920x1080) */
    readonly outputSize: Size;

    /** The actual rendered display size (e.g., 640x360) */
    readonly displaySize: Size;

    /** Scale factor: display / output (typically < 1 in editor, > 1 when zoomed) */
    readonly scale: number;

    /** Inverse scale factor: output / display */
    readonly invScale: number;

    constructor(outputSize: Size, displaySize: Size) {
        this.outputSize = outputSize;
        this.displaySize = displaySize;

        // Calculate scale (use width, assume uniform scaling)
        this.scale = displaySize.width / outputSize.width;
        this.invScale = outputSize.width / displaySize.width;
    }

    // ─────────────────────────────────────────────────────────────
    // Output → Display conversions
    // ─────────────────────────────────────────────────────────────

    /**
     * Converts a rectangle from output coordinates to display coordinates.
     */
    outputToDisplay(rect: Rect): Rect {
        return {
            x: rect.x * this.scale,
            y: rect.y * this.scale,
            width: rect.width * this.scale,
            height: rect.height * this.scale,
        };
    }

    /**
     * Converts a single length value from output to display units.
     */
    outputToDisplayLength(length: number): number {
        return length * this.scale;
    }

    /**
     * Converts corner radii from output to display units.
     */
    outputToDisplayRadii(radii: CornerRadii): CornerRadii {
        return radii.map(r => r * this.scale) as CornerRadii;
    }

    // ─────────────────────────────────────────────────────────────
    // Display → Output conversions
    // ─────────────────────────────────────────────────────────────

    /**
     * Converts a rectangle from display coordinates to output coordinates.
     */
    displayToOutput(rect: Rect): Rect {
        return {
            x: rect.x * this.invScale,
            y: rect.y * this.invScale,
            width: rect.width * this.invScale,
            height: rect.height * this.invScale,
        };
    }

    /**
     * Converts a single length value from display to output units.
     */
    displayToOutputLength(length: number): number {
        return length * this.invScale;
    }

    /**
     * Converts corner radii from display to output units.
     */
    displayToOutputRadii(radii: CornerRadii): CornerRadii {
        return radii.map(r => r * this.invScale) as CornerRadii;
    }

    // ─────────────────────────────────────────────────────────────
    // CSS / Percentage helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Converts an output rect to CSS percentage positioning (relative to output size).
     * Returns values ready for CSS: { left, top, width, height } as percentage strings.
     */
    outputToPercentCSS(rect: Rect): {
        left: string;
        top: string;
        width: string;
        height: string;
    } {
        return {
            left: `${(rect.x / this.outputSize.width) * 100}%`,
            top: `${(rect.y / this.outputSize.height) * 100}%`,
            width: `${(rect.width / this.outputSize.width) * 100}%`,
            height: `${(rect.height / this.outputSize.height) * 100}%`,
        };
    }

    /**
     * Converts corner radii from output units to CSS percentage strings.
     * Returns the CSS border-radius value for per-corner radii.
     * Format: "tl% tr% br% bl% / tl% tr% br% bl%" for elliptical radii.
     */
    outputRadiiToPercentCSS(radii: CornerRadii, rectWidth: number, rectHeight: number): string {
        if (radii.every(r => r === 0)) return '0';

        const [tl, tr, br, bl] = radii;

        // Convert each radius to percentage of rect dimensions
        // Horizontal radii as % of width, vertical radii as % of height
        const tlXPct = (tl / rectWidth) * 100;
        const trXPct = (tr / rectWidth) * 100;
        const brXPct = (br / rectWidth) * 100;
        const blXPct = (bl / rectWidth) * 100;

        const tlYPct = (tl / rectHeight) * 100;
        const trYPct = (tr / rectHeight) * 100;
        const brYPct = (br / rectHeight) * 100;
        const blYPct = (bl / rectHeight) * 100;

        return `${tlXPct}% ${trXPct}% ${brXPct}% ${blXPct}% / ${tlYPct}% ${trYPct}% ${brYPct}% ${blYPct}%`;
    }

    // ─────────────────────────────────────────────────────────────
    // SVG helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Returns a viewBox string for SVG that uses output coordinates.
     * When combined with width="100%" height="100%" and preserveAspectRatio="none",
     * this allows SVG elements to use output coordinates directly and scale to display.
     */
    getSvgViewBox(): string {
        return `0 0 ${this.outputSize.width} ${this.outputSize.height}`;
    }

    /**
     * Creates an SVG path for a rounded rectangle with per-corner radii.
     * Uses arc commands (A) for true circular corners matching CSS border-radius.
     * All values should be in output coordinates.
     */
    createRoundedRectPath(rect: Rect, radii: CornerRadii): string {
        const { x, y, width, height } = rect;

        // Clamp radii to prevent overlap
        const maxRadiusX = width / 2;
        const maxRadiusY = height / 2;
        const [tl, tr, br, bl] = radii.map(r => Math.min(r, maxRadiusX, maxRadiusY));

        // SVG path with arc commands for true circular corners
        // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
        // - rx, ry: radius (same for circular)
        // - x-axis-rotation: 0 (no rotation)
        // - large-arc-flag: 0 (small arc)
        // - sweep-flag: 1 (clockwise)
        // Start at top-left after the corner, go clockwise
        return `
            M ${x + tl} ${y}
            L ${x + width - tr} ${y}
            A ${tr} ${tr} 0 0 1 ${x + width} ${y + tr}
            L ${x + width} ${y + height - br}
            A ${br} ${br} 0 0 1 ${x + width - br} ${y + height}
            L ${x + bl} ${y + height}
            A ${bl} ${bl} 0 0 1 ${x} ${y + height - bl}
            L ${x} ${y + tl}
            A ${tl} ${tl} 0 0 1 ${x + tl} ${y}
            Z
        `.trim();
    }
}
