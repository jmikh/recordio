import type { DeviceFrame } from './types';


const FRAME_W = 661;
const FRAME_H = 431;

const SCREEN_X = 56;
const SCREEN_Y = 33;
const SCREEN_W = 530;
const SCREEN_H = 340;

export const MACBOOK_FRAME: DeviceFrame = {
    id: 'macbook-air',
    name: 'MacBook Air',
    imageUrl: '/assets/macbook-frame.png',

    size: { width: FRAME_W, height: FRAME_H },

    screenRect: {
        x: SCREEN_X,
        y: SCREEN_Y,
        width: SCREEN_W,
        height: SCREEN_H
    },

    borderData: {
        left: SCREEN_X / FRAME_W,
        right: (FRAME_W - (SCREEN_X + SCREEN_W)) / FRAME_W,
        top: SCREEN_Y / FRAME_H,
        bottom: (FRAME_H - (SCREEN_Y + SCREEN_H)) / FRAME_H
    }
};

export const DEVICE_FRAMES: DeviceFrame[] = [
    MACBOOK_FRAME
];

export function getDeviceFrame(id: string | undefined): DeviceFrame | undefined {
    return DEVICE_FRAMES.find(f => f.id === id);
}
