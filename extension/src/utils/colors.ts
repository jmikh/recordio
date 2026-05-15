/**
 * Shared color constants for use in contexts where CSS variables aren't available
 * (e.g., Chrome extension badge API in service workers).
 *
 * These values are derived from the OKLCH design system in src/index.css.
 * If the design system colors change, update these values accordingly.
 */

// Text on secondary: oklch(0.15 0 0) - near black for contrast
export const TEXT_ON_SECONDARY_HEX = '#0b0b0b';

// Badge: recording active (green)
export const BADGE_RECORDING_COLOR_HEX = '#9ad683';
// Badge: recording paused (yellow)
export const BADGE_PAUSED_COLOR_HEX = '#f2b036';
// Badge text (black for contrast on both green and yellow)
export const BADGE_TEXT_COLOR_HEX = '#000000';

