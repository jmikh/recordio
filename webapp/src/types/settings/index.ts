/**
 * Settings Types Barrel
 * 
 * All project settings types.
 */

export * from './style';
export * from './camera';
export * from './screen';
export * from './background';
export * from './zoom';
export * from './spotlight';
export * from './effects';
export * from './captions';

// Aggregated settings type
import type { Size } from '@shared/types';
import type { CameraSettings } from './camera';
import type { ScreenSettings } from './screen';
import type { BackgroundSettings } from './background';
import type { ZoomSettings } from './zoom';
import type { SpotlightSettings } from './spotlight';
import type { EffectSettings } from './effects';
import type { CaptionSettings } from './captions';

export interface ProjectSettings {
    outputSize: Size;
    frameRate: number;

    // Zoom
    zoom: ZoomSettings;

    // Spotlight
    spotlight: SpotlightSettings;

    // Effects
    effects: EffectSettings;

    // Background
    background: BackgroundSettings;

    // Screen Content
    screen: ScreenSettings;

    // Camera
    camera?: CameraSettings;

    // Captions
    captions: CaptionSettings;
}
