import type { DeviceFrame } from '../../types';

export interface SliceSegment {
    start: number; // Percent 0-1
    end: number;   // Percent 0-1
    scalable: boolean;
}

export interface FrameScalingConfig {
    vertical: SliceSegment[];
    horizontal: SliceSegment[];
}

/**
 * Draws an image using 9-slice (or n-slice) scaling logic based on the provided configuration.
 * It divides the source image into a grid of regions defined by horizontal and vertical slices.
 * Fixed regions maintain their source dimensions (or scale uniformly if dest is too small).
 * Scalable regions stretch to fill the remaining space.
 */
function drawSmartFrame(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLCanvasElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    config: FrameScalingConfig
) {
    const sw = img.width; // Source Width (natural size)
    const sh = img.height; // Source Height

    if (typeof sw !== 'number' || typeof sh !== 'number' || sw === 0 || sh === 0) return;

    // 0. Calculate Base Scale (Uniform Scaling Factor)
    // We determine the "Safe" scale (= Min) that ensures the source fits entirely within the destination
    // without distortion. This scale is applied to all "fixed" (non-scalable) segments.
    //
    // - If scaleX < scaleY: The width fits perfectly. The height will be stretched using scalable segments.
    // - If scaleY < scaleX: The height fits perfectly. The width will be stretched using scalable segments.
    const scaleX = dw / sw;
    const scaleY = dh / sh;
    const baseScale = Math.min(scaleX, scaleY);


    // 1. Calculate Source Metrics for Horizontal Slices
    const hSlices = config.horizontal.map(s => {
        const segSw = (s.end - s.start) * sw;
        return { ...s, sw: segSw };
    });

    const vSlices = config.vertical.map(s => {
        const segSh = (s.end - s.start) * sh;
        return { ...s, sh: segSh };
    });

    // 2. Calculate Destination Dimensions
    // Fixed segments get multiplied by baseScale.
    // Scalable segments take the remaining space.

    // --- Horizontal ---
    const totalFixedSw = hSlices.reduce((sum, s) => s.scalable ? sum : sum + s.sw, 0);
    const totalFixedDw = totalFixedSw * baseScale;
    let availableScalableW = dw - totalFixedDw;
    if (availableScalableW < 0) availableScalableW = 0;

    const totalScalableSw = hSlices.reduce((sum, s) => s.scalable ? sum + s.sw : sum, 0);

    const hSlicesFinal = hSlices.map(s => {
        let segDw = 0;
        if (s.scalable) {
            const ratio = totalScalableSw > 0 ? (s.sw / totalScalableSw) : 0;
            segDw = availableScalableW * ratio;
        } else {
            segDw = s.sw * baseScale;
        }
        return { ...s, dw: segDw };
    });

    // --- Vertical ---
    const totalFixedSh = vSlices.reduce((sum, s) => s.scalable ? sum : sum + s.sh, 0);
    const totalFixedDh = totalFixedSh * baseScale;
    let availableScalableH = dh - totalFixedDh;
    if (availableScalableH < 0) availableScalableH = 0;

    const totalScalableSh = vSlices.reduce((sum, s) => s.scalable ? sum + s.sh : sum, 0);

    const vSlicesFinal = vSlices.map(s => {
        let segDh = 0;
        if (s.scalable) {
            const ratio = totalScalableSh > 0 ? (s.sh / totalScalableSh) : 0;
            segDh = availableScalableH * ratio;
        } else {
            segDh = s.sh * baseScale;
        }
        return { ...s, dh: segDh };
    });

    // 4. Draw the Grid
    let currentDy = dy;

    for (const vSlice of vSlicesFinal) {
        const sy = vSlice.start * sh;
        let currentDx = dx;

        for (const hSlice of hSlicesFinal) {
            const sx = hSlice.start * sw;

            if (hSlice.dw > 0.5 && vSlice.dh > 0.5) {
                ctx.drawImage(
                    img,
                    sx, sy, hSlice.sw, vSlice.sh,
                    currentDx, currentDy, hSlice.dw, vSlice.dh
                );
            }

            currentDx += hSlice.dw;
        }

        currentDy += vSlice.dh;
    }
}

/**
 * Computes where a source-space rectangle lands after 9-slice rendering.
 * Uses the same slice math as drawSmartFrame so the result aligns pixel-perfectly
 * with the rendered frame image.
 *
 * @param screenRect  The screen area in source image pixels (e.g., { x: 329, y: 137, w: 2562, h: 1608 })
 * @param imageSize   The full source image dimensions
 * @param destRect    Where the frame is drawn on the canvas (position + size)
 * @param config      9-slice configuration
 * @returns           The screen rect in canvas coordinates
 */
export function resolveScreenRect(
    screenRect: { x: number; y: number; width: number; height: number },
    imageSize: { width: number; height: number },
    destRect: { x: number; y: number; width: number; height: number },
    config: FrameScalingConfig
): { x: number; y: number; width: number; height: number } {
    const sw = imageSize.width;
    const sh = imageSize.height;

    const scaleX = destRect.width / sw;
    const scaleY = destRect.height / sh;
    const baseScale = Math.min(scaleX, scaleY);

    // Map a source pixel position to destination position along one axis
    function mapAxis(
        srcPos: number,
        srcLen: number,
        totalSrc: number,
        destTotal: number,
        slices: SliceSegment[]
    ): { pos: number; len: number } {
        // Compute destination width of each slice
        const sliceData = slices.map(s => {
            const segSrc = (s.end - s.start) * totalSrc;
            return { ...s, srcSize: segSrc };
        });

        const totalFixedSrc = sliceData.reduce((sum, s) => s.scalable ? sum : sum + s.srcSize, 0);
        const totalFixedDst = totalFixedSrc * baseScale;
        const availableScalable = Math.max(0, destTotal - totalFixedDst);
        const totalScalableSrc = sliceData.reduce((sum, s) => s.scalable ? sum + s.srcSize : sum, 0);

        const mapped = sliceData.map(s => {
            const dstSize = s.scalable
                ? (totalScalableSrc > 0 ? availableScalable * (s.srcSize / totalScalableSrc) : 0)
                : s.srcSize * baseScale;
            return { ...s, dstSize };
        });

        // Walk slices to find where srcPos and srcPos+srcLen land
        function mapPoint(p: number): number {
            let dstOffset = 0;
            for (const s of mapped) {
                const sliceSrcStart = s.start * totalSrc;
                const sliceSrcEnd = s.end * totalSrc;
                if (p <= sliceSrcStart) return dstOffset;
                if (p >= sliceSrcEnd) {
                    dstOffset += s.dstSize;
                    continue;
                }
                // p is inside this slice
                const frac = (p - sliceSrcStart) / s.srcSize;
                return dstOffset + frac * s.dstSize;
            }
            return dstOffset;
        }

        const pos = mapPoint(srcPos);
        const end = mapPoint(srcPos + srcLen);
        return { pos, len: end - pos };
    }

    const hResult = mapAxis(screenRect.x, screenRect.width, sw, destRect.width, config.horizontal);
    const vResult = mapAxis(screenRect.y, screenRect.height, sh, destRect.height, config.vertical);

    return {
        x: destRect.x + hResult.pos,
        y: destRect.y + vResult.pos,
        width: hResult.len,
        height: vResult.len
    };
}

/**
 * Draws a device frame image at the given rectangle.
 * The frameRect is pre-computed by ViewMapper to account for padding and centering.
 *
 * @param ctx Canvas rendering context
 * @param deviceFrame Device frame metadata including scaling config
 * @param img Pre-loaded device frame image element
 * @param frameRect The output-space rectangle where the frame should be drawn
 */
export function drawDeviceFrame(
    ctx: CanvasRenderingContext2D,
    deviceFrame: DeviceFrame,
    img: HTMLImageElement,
    frameRect: { x: number; y: number; width: number; height: number }
): void {
    ctx.imageSmoothingQuality = 'high';
    drawSmartFrame(ctx, img, frameRect.x, frameRect.y, frameRect.width, frameRect.height, deviceFrame.customScaling);
}
