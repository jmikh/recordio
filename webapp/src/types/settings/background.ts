/**
 * Background Settings
 */

export interface BackgroundSettings {
    type: 'color' | 'preset' | 'custom';
    color: string;
    gradientColors: [string, string];
    /** Gradient angle in degrees (0-360). 0 = up, 90 = right, 180 = down, 270 = left */
    gradientDirection: number;
    /** Static URL for preset backgrounds (type: 'preset') */
    imageUrl?: string;
    /** Persistent URL for custom uploads (type: 'custom'). recordio-blob:// protocol. */
    customStorageUrl?: string;
    /** Transient blob URL for custom uploads. Populated on load, never saved. */
    customRuntimeUrl?: string;
    /** ID of the global library entry this background came from. Used for matching. */
    customLibraryId?: string;
    colorMode: 'gradient' | 'solid';
    backgroundBlur: number;
}

export type BackgroundType = 'solid' | 'image';
