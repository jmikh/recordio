import { describe, it, expect } from 'vitest';
import { getActiveCameraMatte } from './cameraMatte';
import type { Project, CameraMoveSegment } from '../types';

const matte = { storagePath: 'u/p/camera-matte.webm' };

function project(opts: { removeBackground?: boolean; matte?: boolean; blocks?: Partial<CameraMoveSegment>[]; cameraMoveEnabled?: boolean }): Project {
    return {
        cameraSource: { storagePath: 'u/p/camera.webm', size: { width: 1280, height: 720 }, ...(opts.matte === false ? {} : { matte }) },
        settings: {
            camera: { removeBackground: opts.removeBackground },
            cameraMove: { enabled: opts.cameraMoveEnabled ?? true, transitionDurationMs: 500, easing: 'ease-in-out' },
        },
        timeline: { cameraMoveSegments: (opts.blocks ?? []).map(b => ({ visible: true, ...b })) },
    } as unknown as Project;
}

describe('getActiveCameraMatte', () => {
    it('active while the camera setting removes the background', () => {
        expect(getActiveCameraMatte(project({ removeBackground: true }))).toBe(matte);
        expect(getActiveCameraMatte(project({}))).toBeNull();
    });

    it('active while a layout block removes it', () => {
        expect(getActiveCameraMatte(project({ blocks: [{ removeBackground: true }] }))).toBe(matte);
        expect(getActiveCameraMatte(project({ blocks: [{ removeBackground: false }] }))).toBeNull();
    });

    it('ignores hidden, cut and disabled blocks', () => {
        expect(getActiveCameraMatte(project({ blocks: [{ removeBackground: true, hidden: true }] }))).toBeNull();
        expect(getActiveCameraMatte(project({ blocks: [{ removeBackground: true, visible: false }] }))).toBeNull();
        expect(getActiveCameraMatte(project({ blocks: [{ removeBackground: true }], cameraMoveEnabled: false }))).toBeNull();
    });

    it('null until the mask exists', () => {
        expect(getActiveCameraMatte(project({ removeBackground: true, matte: false }))).toBeNull();
    });
});
