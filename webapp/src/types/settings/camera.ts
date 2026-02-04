/**
 * Camera Settings
 */

import type { StyleSettings } from './style';

export interface CameraSettings extends StyleSettings {
    width: number;
    height: number;
    x: number;
    y: number;
    shape: 'circle' | 'rect' | 'square';

    /** Zoom/crop within the camera video feed (1x = no crop, 3x = 3x zoom) */
    cropZoom: number;

    /** Enable auto-shrink when screen is zoomed in */
    autoShrink?: boolean;

    /** Scale factor when shrunk (0.25 = 25%, 0.5 = 50%, 0.75 = 75%). Default: 0.5 */
    shrinkScale?: number;
}
