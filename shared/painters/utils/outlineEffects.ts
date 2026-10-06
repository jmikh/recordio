/**
 * Drop shadow and glow cast by the camera bubble and the screen in border mode.
 *
 * One effect at a time (StyleSettings.effect) at one amount
 * (StyleSettings.effectAmount, 0–1; 0 = no effect). The effect scales
 * linearly with the amount, so 1 is 2.5× the default. Reference values are
 * at 1080p output and the default amount, scaled by the caller's effectScale.
 */

import type { StyleSettings } from '../../types';

export const DEFAULT_EFFECT_AMOUNT = 0.4;

// Hard shadow: the blur is short next to the offset, so the edge stays crisp
const REF_SHADOW_OFFSET = 12;
const REF_SHADOW_BLUR = 12;
const REF_SHADOW_OPACITY = 0.15;
const MAX_SHADOW_OPACITY = 0.75;
const REF_GLOW_BLUR = 25;

/**
 * Sets the context's shadow to the drop shadow at `amount`, cast along
 * `direction` (canvas pixels, any length). Without one, or when it's zero,
 * it falls 45° to the bottom right.
 */
export function applyShadow(ctx: CanvasRenderingContext2D, amount: number, effectScale: number, direction?: { x: number, y: number }) {
    const k = amount / DEFAULT_EFFECT_AMOUNT;
    // REF_SHADOW_OFFSET is the reach along each axis at 45°; every angle keeps that distance
    const distance = Math.SQRT2 * REF_SHADOW_OFFSET * k * effectScale;
    const length = direction ? Math.hypot(direction.x, direction.y) : 0;
    const [ux, uy] = direction && length > 0
        ? [direction.x / length, direction.y / length]
        : [Math.SQRT1_2, Math.SQRT1_2];
    ctx.shadowBlur = REF_SHADOW_BLUR * k * effectScale;
    // Shadow offsets ignore the transform, so the mirrored camera casts the same way
    ctx.shadowOffsetX = distance * ux;
    ctx.shadowOffsetY = distance * uy;
    // Darkens as it grows
    ctx.shadowColor = `rgba(0,0,0,${Math.min(MAX_SHADOW_OPACITY, REF_SHADOW_OPACITY * k)})`;
}

/** Sets the context's shadow to the glow at `amount`, in the outline color. */
export function applyGlow(ctx: CanvasRenderingContext2D, color: string, amount: number, effectScale: number) {
    ctx.shadowBlur = REF_GLOW_BLUR * (amount / DEFAULT_EFFECT_AMOUNT) * effectScale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = color;
}

/**
 * Sets the context's shadow to the style's effect and returns the fill for
 * the caster shape: the effect's own color, so the antialiased edge left
 * under the content blends into it. Null (context untouched) at amount 0.
 * `shadowDirection` as in applyShadow.
 */
export function applyStyleEffect(ctx: CanvasRenderingContext2D, style: StyleSettings, effectScale: number, shadowDirection?: { x: number, y: number }): string | null {
    const { effect = 'shadow', effectAmount = 0, borderColor = '#ffffff' } = style;
    if (effectAmount <= 0) return null;
    if (effect === 'glow') {
        applyGlow(ctx, borderColor, effectAmount, effectScale);
        return borderColor;
    }
    applyShadow(ctx, effectAmount, effectScale, shadowDirection);
    return 'black';
}
