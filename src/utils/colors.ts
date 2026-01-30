/**
 * Shared color constants for use in contexts where CSS variables aren't available
 * (e.g., Chrome extension badge API in service workers).
 * 
 * These values are derived from the OKLCH design system in src/index.css.
 * If the design system colors change, update these values accordingly.
 */

// Secondary color: oklch(0.80 0.15 78) - golden/amber
export const SECONDARY_COLOR_HEX = '#f2b036';

// Text on secondary: oklch(0.15 0 0) - near black for contrast
export const TEXT_ON_SECONDARY_HEX = '#0b0b0b';

