
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
    // We want fixed elements (corners, bezels) to scale up with the image size,
    // but without distorting (changing aspect ratio).
    // We use the smaller scale factor to ensure everything fits.
    // However, usually we want to scale to FIT the destination.
    // If the destination aspect ratio matches the source, scaleX === scaleY.
    // If not, we pick the one that "makes sense" for fixed elements.
    // Usually, for a frame, we want the borders to look consistent.
    // Let's use the smaller scale to be safe (fit behavior), or average?
    // Actually, strictly speaking, if we stretch a frame, we might want horizontal borders to scale with Width
    // and vertical borders to scale with Height?
    // User request: "only scale the frame to fit first side of the side, then scale the remaining using the custom scalign dimensions"
    // Interpretation:
    // 1. Scale the WHOLE frame uniformly until one dimension fits the destination (e.g. Width).
    // 2. The other dimension (e.g. Height) might be too short or too long.
    // 3. We use the scalable segments to take up that slack.

    // Let's try determining scale based on the "tightest" dimension?
    // Or simply: Min(dw/sw, dh/sh) is the "Safe" scale where aspect ratio is preserved.
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
