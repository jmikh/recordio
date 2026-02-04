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
    // The inner screen rectangle in the frame image (relative to image 0,0)
    // Used to calculate border thickness ratios
    screenRect: Rect;
    // Total size of the frame image
    size: Size;
    borderData: FrameBorderData;
    customScaling?: FrameScalingConfig;
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

export interface FrameBorderData {
    // Ratios of border thickness to total size (0..1)
    top: number;
    bottom: number;
    left: number;
    right: number;
}
