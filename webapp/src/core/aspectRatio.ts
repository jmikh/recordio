import type { Size } from '@shared/types';

export interface AspectRatioPreset {
    label: string;
    width: number;
    height: number;
    orientation?: string;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
    { label: '1:1', width: 1080, height: 1080, orientation: 'Square' },
    { label: '4:3', width: 1440, height: 1080, orientation: 'Horizontal' },
    { label: '16:9', width: 1920, height: 1080, orientation: 'Horizontal' },
    { label: '3:4', width: 1080, height: 1440, orientation: 'Vertical' },
    { label: '9:16', width: 1080, height: 1920, orientation: 'Vertical' },
];

/** Default preset (16:9) */
const DEFAULT_PRESET = ASPECT_RATIO_PRESETS[2];

/**
 * Find the matching aspect ratio preset for an outputSize.
 * Matches by aspect ratio (width/height) rather than exact pixels.
 */
export function findPreset(outputSize: Size): AspectRatioPreset {
    const ratio = outputSize.width / outputSize.height;
    return ASPECT_RATIO_PRESETS.find(p => {
        const presetRatio = p.width / p.height;
        return Math.abs(ratio - presetRatio) < 0.01;
    }) || DEFAULT_PRESET;
}
