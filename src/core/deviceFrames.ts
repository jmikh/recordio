import type { DeviceFrame, FrameScalingConfig } from './types';


function defineFrame(
    id: string,
    name: string,
    imageUrl: string,
    dimensions: { width: number; height: number },
    screen: { x: number; y: number; width: number; height: number },
    _customScaling?: FrameScalingConfig // Deprecated/Ignored
): DeviceFrame {
    const customScaling: FrameScalingConfig = {
        vertical: [
            { start: 0, end: 0.33, scalable: false },
            { start: 0.33, end: 0.66, scalable: true },
            { start: 0.66, end: 1, scalable: false }
        ],
        horizontal: [
            { start: 0, end: 0.15, scalable: false },
            { start: 0.15, end: 0.3, scalable: true },
            { start: 0.3, end: 0.7, scalable: true },
            { start: 0.7, end: 0.85, scalable: true },
            { start: 0.85, end: 1, scalable: false }
        ]
    };

    return {
        id,
        name,
        imageUrl,
        size: dimensions,
        screenRect: screen,
        borderData: {
            left: screen.x / dimensions.width,
            right: (dimensions.width - (screen.x + screen.width)) / dimensions.width,
            top: screen.y / dimensions.height,
            bottom: (dimensions.height - (screen.y + screen.height)) / dimensions.height
        },
        customScaling
    };
}

export const MACBOOK_FRAME = defineFrame(
    'macbook-air',
    'MacBook Silver',
    '/assets/devices/macbook.png',
    { width: 4340, height: 2860 },
    { x: 442, y: 313, width: 3456, height: 2234 }
);

export const STUDIO_DISPLAY_FRAME = defineFrame(
    'studio-display',
    'Studio Display',
    '/assets/devices/studio-display.png',
    { width: 1228, height: 944 },
    { x: 26, y: 26, width: 1176, height: 662 }
);

export const MACBOOK_DARK_FRAME = defineFrame(
    'macbook-dark',
    'MacBook Air Dark',
    '/assets/devices/macbook-dark.png',
    { width: 3220, height: 2100 },
    { x: 329, y: 217, width: 2562, height: 1666 }
);

export const DEVICE_FRAMES: DeviceFrame[] = [
    MACBOOK_FRAME,
    MACBOOK_DARK_FRAME,
    STUDIO_DISPLAY_FRAME
];

export function getDeviceFrame(id: string | undefined): DeviceFrame | undefined {
    return DEVICE_FRAMES.find(f => f.id === id);
}
