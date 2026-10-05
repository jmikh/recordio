import type { Size, Rect } from '../types';
import type { SpotlightState } from '../animators/spotlightAnimator';
import type { RenderContext, CanvasHandle } from '../utils/renderContext';
import { roundRectPath } from './utils/roundRect';

// Cached offscreen canvas for spotlight snapshots (avoids per-frame allocation)
let _snapshot: CanvasHandle | null = null;
// Cached offscreen canvas for the feathered alpha mask
let _mask: CanvasHandle | null = null;

// Extra feather at the START of a close-in transition, as a fraction of the shorter
// output dimension. Eases down to the configured feather as the transition ends.
const CLOSE_IN_FEATHER_BOOST = 0.25;

/**
 * Draws the spotlight overlay effect on the canvas.
 *
 * The effect consists of:
 * 1. Snapshot the spotlight region (plus feather padding) from the current canvas,
 *    capturing all previously painted layers
 * 2. A semi-transparent dark overlay covering the entire canvas
 * 3. The snapshotted content drawn back over the dim through a feathered alpha mask,
 *    so the spotlight fades out into the dim instead of having a hard edge
 *
 * Because the spotlight samples what's already on the canvas, all effects (mouse clicks,
 * drags, debug overlays) are preserved inside the spotlight region.
 *
 * Transitions (settings.spotlight.featherTransition):
 * - 'closeIn': the dim is at full strength from the start and the clear region shrinks
 *   from the whole frame down to the spotlight rect on entry, then grows back out on exit.
 *   The feather is extra wide while moving and settles to the configured width.
 * - 'fade': the geometry stays put and the dim opacity fades in and out uniformly.
 *
 * If the spotlight region is outside the current viewport:
 * - Dimming still applies (entire screen is dimmed, uniform fade)
 * - No content is restored
 *
 * @param ctx - Canvas rendering context
 * @param spotlightState - Current spotlight state (null = no spotlight)
 * @param outputSize - Canvas dimensions
 * @param sourceCanvas - The canvas to sample existing content from for the spotlight region
 */
export function drawSpotlight(
    ctx: CanvasRenderingContext2D,
    spotlightState: SpotlightState | null,
    outputSize: Size,
    sourceCanvas?: CanvasImageSource & Size,
    renderCtx?: RenderContext
): void {
    // Skip if no spotlight state OR nothing is dimmed yet (dimOpacity = 0 means no effect)
    if (!spotlightState || spotlightState.dimOpacity <= 0) {
        return;
    }

    const { isVisible, originalRect, borderRadiusPx, progress } = spotlightState;
    // Feather width in OUTPUT px (0 = hard edge)
    const featherPx = Math.max(0, spotlightState.featherPx ?? 0);

    const closingIn = spotlightState.featherTransition === 'closeIn'
        && spotlightState.phase !== 'hold';
    const dimOpacity = closingIn ? spotlightState.fullDimOpacity : spotlightState.dimOpacity;
    let grow = 0;
    // While closing in, the feather starts much wider and eases down to the configured
    // width as the transition completes, so the moving edge is soft rather than harsh.
    let effectiveFeatherPx = featherPx;
    if (closingIn && isVisible && originalRect) {
        const p = Math.min(1, Math.max(0, progress ?? 1));
        const featherBoost = CLOSE_IN_FEATHER_BOOST * Math.min(outputSize.width, outputSize.height);
        effectiveFeatherPx = featherPx + featherBoost * (1 - p);
        const maxGrow = Math.max(
            originalRect.x,
            originalRect.y,
            outputSize.width - (originalRect.x + originalRect.width),
            outputSize.height - (originalRect.y + originalRect.height),
            0
        ) + (featherPx + featherBoost) * 2;
        grow = maxGrow * (1 - p);
    }

    // =========================================================
    // CASE 1: Spotlight NOT visible in viewport
    // Just dim the entire screen (uniform fade — no rect to close in on)
    // =========================================================
    if (!isVisible || !originalRect) {
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${spotlightState.dimOpacity})`;
        ctx.fillRect(0, 0, outputSize.width, outputSize.height);
        ctx.restore();
        return;
    }

    // =========================================================
    // CASE 2: Spotlight IS visible
    // Snapshot → Dim → Draw feathered content back
    // =========================================================

    // Snapshot the padded spotlight region BEFORE dimming using GPU-side drawImage
    // (avoids expensive getImageData GPU→CPU readback)
    let hasSnapshot = false;
    let sx = 0;
    let sy = 0;
    if (sourceCanvas && renderCtx) {
        // Pad by 2× the feather so the gaussian tail (σ = feather/4, centred feather/2 out)
        // is ~0 before the snapshot edge; padding by 1× leaves a ~2% step that reads as a line.
        const pad = Math.ceil(effectiveFeatherPx * 2 + grow);
        sx = Math.max(0, Math.round(originalRect.x - pad));
        sy = Math.max(0, Math.round(originalRect.y - pad));
        const ex = Math.min(Math.round(originalRect.x + originalRect.width + pad), sourceCanvas.width || 0);
        const ey = Math.min(Math.round(originalRect.y + originalRect.height + pad), sourceCanvas.height || 0);
        const sw = ex - sx;
        const sh = ey - sy;
        if (sw > 0 && sh > 0) {
            // Reuse or create the cached offscreen canvas
            if (!_snapshot || _snapshot.canvas.width !== sw || _snapshot.canvas.height !== sh) {
                _snapshot = renderCtx.createCanvas(sw, sh);
            }
            _snapshot.ctx.clearRect(0, 0, sw, sh);
            _snapshot.ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            hasSnapshot = true;
        }
    }

    // Step 1: Dim the ENTIRE canvas (no cut-outs, no seams)
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${dimOpacity})`;
    ctx.fillRect(0, 0, outputSize.width, outputSize.height);
    ctx.restore();

    // Step 2: Draw spotlight content back on top of the dimmed canvas
    if (hasSnapshot && _snapshot && renderCtx) {
        drawFeatheredContent(ctx, _snapshot, sx, sy, originalRect, borderRadiusPx, effectiveFeatherPx, grow, renderCtx);
    }
}

/**
 * Restores the spotlight content at 1:1 scale with a feathered (blurred) edge.
 * Builds a blurred alpha mask of the spotlight shape, multiplies the (padded) snapshot by it,
 * and draws the result over the dimmed canvas. Content inside the rect (grown outward by
 * `grow` px while the transition closes in) stays fully opaque; the fade runs outward from
 * that edge across featherPx.
 */
function drawFeatheredContent(
    ctx: CanvasRenderingContext2D,
    snapshot: CanvasHandle,
    sx: number,
    sy: number,
    originalRect: Rect,
    radiusPx: [number, number, number, number],
    featherPx: number,
    grow: number,
    renderCtx: RenderContext
): void {
    const w = snapshot.canvas.width;
    const h = snapshot.canvas.height;

    if (!_mask || _mask.canvas.width !== w || _mask.canvas.height !== h) {
        _mask = renderCtx.createCanvas(w, h);
    }
    const mctx = _mask.ctx;
    const rx = originalRect.x - sx;
    const ry = originalRect.y - sy;
    const hasRoundedCorners = radiusPx.some(r => r > 0);
    const shapePath = (grow: number) => {
        if (hasRoundedCorners) {
            const radii: [number, number, number, number] = [
                radiusPx[0] + grow, radiusPx[1] + grow, radiusPx[2] + grow, radiusPx[3] + grow
            ];
            roundRectPath(mctx, rx - grow, ry - grow, originalRect.width + grow * 2, originalRect.height + grow * 2, radii);
        } else {
            mctx.beginPath();
            mctx.rect(rx - grow, ry - grow, originalRect.width + grow * 2, originalRect.height + grow * 2);
        }
    };

    mctx.save();
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#000';

    // Outward-only feather: blur a shape grown by half the feather so the fade is centred
    // featherPx/2 outside the (grown) rect edge and reaches ~0 at featherPx out...
    if (featherPx > 0) {
        mctx.filter = `blur(${featherPx / 4}px)`;
        shapePath(grow + featherPx / 2);
        mctx.fill();
        mctx.filter = 'none';
    }

    // ...then fill the (grown) rect solid so everything inside stays fully opaque.
    shapePath(grow);
    mctx.fill();
    mctx.restore();

    // Keep only snapshot pixels where the mask is opaque (alpha multiply)
    const sctx = snapshot.ctx;
    sctx.save();
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(_mask.canvas, 0, 0);
    sctx.restore();

    ctx.drawImage(snapshot.canvas, sx, sy);
}
