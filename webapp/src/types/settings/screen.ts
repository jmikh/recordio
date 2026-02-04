/**
 * Screen Settings
 */

import type { ID, Rect } from '@shared/types';
import type { StyleSettings } from './style';

export interface ScreenSettings extends StyleSettings {
    mode: 'device' | 'border';
    deviceFrameId?: ID;
    crop?: Rect;
    padding: number;
    mute: boolean; // defaults to false
}
