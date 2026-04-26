/**
 * Portable rounded-rect path using arcTo — works in every Canvas2D
 * implementation (browser, node-canvas, OffscreenCanvas).
 *
 * Accepts either a single uniform radius or a [tl, tr, br, bl] tuple.
 * Always calls beginPath() so callers don't need to.
 */
export function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radii: number | [number, number, number, number],
): void {
    const [tl, tr, br, bl] = typeof radii === 'number'
        ? [radii, radii, radii, radii]
        : radii;

    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + width - tr, y);
    ctx.arcTo(x + width, y, x + width, y + tr, tr);
    ctx.lineTo(x + width, y + height - br);
    ctx.arcTo(x + width, y + height, x + width - br, y + height, br);
    ctx.lineTo(x + bl, y + height);
    ctx.arcTo(x, y + height, x, y + height - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
}
