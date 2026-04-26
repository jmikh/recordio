import type { DeviceFrame, FrameScalingConfig } from '../types';

/** Standard 9-slice config applied to all device frames */
const STANDARD_SCALING: FrameScalingConfig = {
    vertical: [
        { start: 0, end: 0.33, scalable: false },
        { start: 0.33, end: 0.66, scalable: true },
        { start: 0.66, end: 1, scalable: false }
    ],
    horizontal: [
        { start: 0, end: 0.15, scalable: false },
        { start: 0.15, end: 0.3, scalable: true },
        { start: 0.3, end: 0.7, scalable: false },
        { start: 0.7, end: 0.85, scalable: true },
        { start: 0.85, end: 1, scalable: false }
    ]
};

function defineFrame(
    id: string,
    name: string,
    imageUrl: string,
    dimensions: { width: number; height: number },
    screen: { x: number; y: number; width: number; height: number }
): DeviceFrame {
    return {
        id,
        name,
        imageUrl,
        size: dimensions,
        screenRect: screen,
        customScaling: STANDARD_SCALING,
        thumbnailUrl: imageUrl.replace('.webp', '-small.webp')
    };
}

export const MACBOOK_FRAME = defineFrame(
    'macbook-pro',
    'MacBook Pro',
    'https://cdn.recordio.cc/devices/macbook.webp',
    { width: 3131, height: 1932 },
    { x: 288, y: 101, width: 2548, height: 1600 }
);

export const STUDIO_DISPLAY_FRAME = defineFrame(
    'studio-display',
    'Studio Display',
    'https://cdn.recordio.cc/devices/studio-display.webp',
    { width: 1228, height: 944 },
    { x: 26, y: 26, width: 1176, height: 662 }
);

export const MACBOOK_DARK_FRAME = defineFrame(
    'macbook-air-dark',
    'MacBook Air',
    'https://cdn.recordio.cc/devices/macbook-dark.webp',
    { width: 3220, height: 1962 },
    { x: 329, y: 137, width: 2562, height: 1608 }
);

export const IPAD_PRO_FRAME = defineFrame(
    'ipad-pro',
    'iPad Pro',
    'https://cdn.recordio.cc/devices/ipad.webp',
    { width: 2960, height: 2290 },
    { x: 113, y: 120, width: 2734, height: 2050 }
);

export const DEVICE_FRAMES: DeviceFrame[] = [
    MACBOOK_FRAME,
    MACBOOK_DARK_FRAME,
    STUDIO_DISPLAY_FRAME,
    IPAD_PRO_FRAME
];

export function getDeviceFrame(id: string | undefined): DeviceFrame | undefined {
    return DEVICE_FRAMES.find(f => f.id === id);
}
