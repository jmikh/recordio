/**
 * Spotlight Settings
 */

export interface SpotlightSettings {
    /** Whether to automatically generate spotlights from hovered cards. Default: true */
    isAuto: boolean;
    /** Dim opacity for background (0 = no dim, 1 = fully black). Default: 0.5 */
    dimOpacity: number;
    /** Scale factor when spotlight is active (1.0 = no scale, 1.1 = 10% larger). Default: 1.1 */
    enlargeScale: number;
    /** Transition duration in milliseconds for fade in/out. Default: 300 */
    transitionDurationMs: number;
    /** Minimum hold duration in milliseconds (the shortest a spotlight can be). Default: 200 */
    minHoldDurationMs: number;
    /** Default hold duration in milliseconds (preferred when adding new spotlight). Default: 1000 */
    defaultHoldDurationMs: number;
}
