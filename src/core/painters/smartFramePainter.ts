
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
export function drawSmartFrame(
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
