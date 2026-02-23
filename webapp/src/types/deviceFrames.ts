/**
 * Device Frame Types
 * 
 * Device frames for screen recording presentation.
 */

import type { ID, Rect, Size } from '@shared/types';

export interface DeviceFrame {
    id: ID;
    name: string;
    imageUrl: string;
    thumbnailUrl: string;
    /** The inner screen rectangle in the frame image (pixels, relative to image 0,0) */
    screenRect: Rect;
    /** Total size of the frame image in pixels */
    size: Size;
    /** 9-slice scaling config for stretching the frame to fit different screen aspect ratios */
    customScaling: FrameScalingConfig;
}

export interface FrameScalingConfig {
    vertical: SliceSegment[];
    horizontal: SliceSegment[];
}

export interface SliceSegment {
    start: number;
    end: number;
    scalable: boolean;
}
