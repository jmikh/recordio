/**
 * Style Settings
 * Base visual style properties shared by screen and camera.
 */

/**
 * Shared visual style properties for screen and camera.
 */
export interface StyleSettings {
    /** 
     * Corner radius in output pixels.
     * Applied uniformly to create circular corners (not elliptical).
     * Clamped to half of smaller dimension during rendering.
     */
    borderRadius: number;
    borderWidth: number;
    borderColor: string; // Used for border and glow/shadow color
    hasShadow: boolean;
    hasGlow: boolean;
}
