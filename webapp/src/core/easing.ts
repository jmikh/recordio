/**
 * Shared Easing Utilities
 * 
 * Centralized easing functions used by zoom and spotlight transitions.
 */

export type EasingStyle = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/**
 * Applies the specified easing curve to a linear progress value.
 * @param t - Linear progress (0 to 1)
 * @param style - The easing style to apply
 * @returns Eased progress value (0 to 1)
 */
export function applyEasing(t: number, style: EasingStyle): number {
    t = Math.max(0, Math.min(1, t));

    switch (style) {
        case 'linear':
            return t;
        case 'ease-in':
            return t * t;
        case 'ease-out':
            return 1 - (1 - t) * (1 - t);
        case 'ease-in-out':
            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }
}
