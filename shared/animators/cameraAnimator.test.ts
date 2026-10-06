import { describe, it, expect } from 'vitest';
import { getCameraAnchor, scaleCameraSettings, getCameraStateAtTime, getResolvedCameraStateAtTime } from './cameraAnimator';
import type { ZoomSegment, ZoomSettings, Rect, CameraSettings, CameraMoveSegment } from '../types';

const outputSize = { width: 1920, height: 1080 };

const defaultZoomSettings: ZoomSettings = {
    enabled: true,
    maxZoom: 4,
    transitionDurationMs: 300,
    easing: 'linear',
};

function zoom(outputStart: number, outputEnd: number): ZoomSegment {
    return {
        id: `z-${outputStart}`,
        sourceStartTimeMs: outputStart,
        sourceEndTimeMs: outputEnd,
        outputStartTimeMs: outputStart,
        outputEndTimeMs: outputEnd,
        visible: true,
        rectPx: { x: 500, y: 300, width: 960, height: 540 },
        reason: 'test',
        type: 'manual',
        transitionDurationMs: 300,
        easing: 'linear',
    };
}

// ==========================================
// getCameraAnchor
// ==========================================

describe('getCameraAnchor', () => {
    it('bottom-right quadrant', () => {
        expect(getCameraAnchor({ xPx: 1500, yPx: 800, widthPx: 200, heightPx: 200 }, outputSize)).toBe('bottom-right');
    });

    it('top-left quadrant', () => {
        expect(getCameraAnchor({ xPx: 100, yPx: 100, widthPx: 200, heightPx: 200 }, outputSize)).toBe('top-left');
    });

    it('top-right quadrant', () => {
        expect(getCameraAnchor({ xPx: 1500, yPx: 100, widthPx: 200, heightPx: 200 }, outputSize)).toBe('top-right');
    });

    it('bottom-left quadrant', () => {
        expect(getCameraAnchor({ xPx: 100, yPx: 800, widthPx: 200, heightPx: 200 }, outputSize)).toBe('bottom-left');
    });

    it('exact center defaults to bottom-right', () => {
        const cx = (1920 - 200) / 2; // camera center = output center
        const cy = (1080 - 200) / 2;
        expect(getCameraAnchor({ xPx: cx, yPx: cy, widthPx: 200, heightPx: 200 }, outputSize)).toBe('bottom-right');
    });
});

// ==========================================
// scaleCameraSettings
// ==========================================

describe('scaleCameraSettings', () => {
    const base = { xPx: 100, yPx: 100, widthPx: 200, heightPx: 200 };

    it('scale 1.0 returns same dimensions', () => {
        const result = scaleCameraSettings(base, 1.0, 'top-left');
        expect(result.widthPx).toBe(200);
        expect(result.heightPx).toBe(200);
        expect(result.xPx).toBe(100);
        expect(result.yPx).toBe(100);
    });

    it('scale 0.5 with top-left anchor: position unchanged, size halved', () => {
        const result = scaleCameraSettings(base, 0.5, 'top-left');
        expect(result.widthPx).toBe(100);
        expect(result.heightPx).toBe(100);
        expect(result.xPx).toBe(100);
        expect(result.yPx).toBe(100);
    });

    it('scale 0.5 with bottom-right anchor: keeps bottom-right corner fixed', () => {
        const result = scaleCameraSettings(base, 0.5, 'bottom-right');
        expect(result.widthPx).toBe(100);
        expect(result.heightPx).toBe(100);
        expect(result.xPx + result.widthPx).toBe(300);
        expect(result.yPx + result.heightPx).toBe(300);
    });

    it('scale 0.5 with top-right anchor: keeps top-right corner fixed', () => {
        const result = scaleCameraSettings(base, 0.5, 'top-right');
        expect(result.xPx + result.widthPx).toBe(300);
        expect(result.yPx).toBe(100);
    });

    it('scale 0.5 with bottom-left anchor: keeps bottom-left corner fixed', () => {
        const result = scaleCameraSettings(base, 0.5, 'bottom-left');
        expect(result.xPx).toBe(100);
        expect(result.yPx + result.heightPx).toBe(300);
    });

    it('scale 2.0 doubles size', () => {
        const result = scaleCameraSettings(base, 2.0, 'top-left');
        expect(result.widthPx).toBe(400);
        expect(result.heightPx).toBe(400);
    });
});

// ==========================================
// getCameraStateAtTime
// ==========================================

describe('getCameraStateAtTime', () => {
    it('no zoom segments: scale = 1.0', () => {
        const state = getCameraStateAtTime([], 500, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBe(1.0);
        expect(state.isTransitioning).toBe(false);
    });

    it('before first segment: scale = 1.0', () => {
        const state = getCameraStateAtTime([zoom(1000, 2000)], 500, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBe(1.0);
    });

    it('during transition in: interpolates toward shrinkScale', () => {
        // 150ms into 300ms transition → t=0.5 (linear easing)
        const state = getCameraStateAtTime([zoom(1000, 2000)], 1150, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBeCloseTo(0.75); // 1.0 + (0.5 - 1.0) * 0.5
        expect(state.isTransitioning).toBe(true);
    });

    it('during hold: at shrinkScale', () => {
        const state = getCameraStateAtTime([zoom(1000, 2000)], 1500, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBe(0.5);
        expect(state.isTransitioning).toBe(false);
    });

    it('after segment (gap zoom-out): interpolates back to 1.0', () => {
        // 150ms after segment end → halfway back to 1.0
        const state = getCameraStateAtTime([zoom(1000, 2000)], 2150, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBeCloseTo(0.75); // 0.5 + (1.0 - 0.5) * 0.5
    });

    it('well after segment: back to 1.0', () => {
        const state = getCameraStateAtTime([zoom(1000, 2000)], 2500, outputSize, 0.5, defaultZoomSettings);
        expect(state.sizeScale).toBe(1.0);
    });
});

// ==========================================
// getResolvedCameraStateAtTime
// ==========================================

describe('getResolvedCameraStateAtTime', () => {
    const camera: CameraSettings = {
        xPx: 100, yPx: 700, widthPx: 300, heightPx: 300, shape: 'rect',
        borderRadiusPx: 10, borderColor: '#ffffff', effect: 'shadow', effectAmount: 0,
        cropZoom: 1, autoShrink: false, shrinkScale: 0.5, mirrored: false,
    };

    // Block 1000–5000ms, 500ms linear transitions, moves the camera to x = 1100
    function block(overrides: Partial<CameraMoveSegment> = {}): CameraMoveSegment {
        return {
            id: 'b', sourceStartTimeMs: 1000, sourceEndTimeMs: 5000,
            outputStartTimeMs: 1000, outputEndTimeMs: 5000, visible: true,
            xPx: 1100, yPx: 700, widthPx: 300, heightPx: 300, shape: 'rect', borderRadiusPx: 10,
            transitionDurationMs: 500, easing: 'linear',
            ...overrides,
        };
    }

    const resolve = (segments: CameraMoveSegment[], t: number, settings = camera) =>
        getResolvedCameraStateAtTime(settings, segments, [], t, outputSize, defaultZoomSettings);

    it('transitions in and out by default', () => {
        expect(resolve([block()], 1250).xPx).toBeCloseTo(600);
        expect(resolve([block()], 3000).xPx).toBe(1100);
        expect(resolve([block()], 4750).xPx).toBeCloseTo(600);
    });

    it('animateIn false: cuts to the block values at its start', () => {
        expect(resolve([block({ animateIn: false })], 1000).xPx).toBe(1100);
        expect(resolve([block({ animateIn: false })], 4750).xPx).toBeCloseTo(600);
    });

    it('animateOut false: holds the block values to its end', () => {
        expect(resolve([block({ animateOut: false })], 1250).xPx).toBeCloseTo(600);
        expect(resolve([block({ animateOut: false })], 5000).xPx).toBe(1100);
    });

    it('both off: block values for its whole length', () => {
        const seg = block({ animateIn: false, animateOut: false });
        expect(resolve([seg], 1000).xPx).toBe(1100);
        expect(resolve([seg], 5000).xPx).toBe(1100);
    });

    it('animateOut false on a short block: still transitions in, then cuts', () => {
        const seg = block({ outputEndTimeMs: 1600, sourceEndTimeMs: 1600, animateOut: false });
        expect(resolve([seg], 1250).xPx).toBeCloseTo(600);
        expect(resolve([seg], 1600).xPx).toBe(1100);
    });

    it('hidden block with animateIn false: hides at once', () => {
        expect(resolve([block({ hidden: true, animateIn: false })], 1000).opacity).toBe(0);
        expect(resolve([block({ hidden: true })], 1000).opacity).toBe(1);
    });

    it('cutoutAmount follows the camera setting outside blocks', () => {
        expect(resolve([], 500).cutoutAmount).toBe(0);
        expect(resolve([], 500, { ...camera, removeBackground: true }).cutoutAmount).toBe(1);
    });

    it('cutoutAmount blends from the camera setting to the block value', () => {
        const cutoutCamera = { ...camera, removeBackground: true };
        const seg = block({ removeBackground: false });
        expect(resolve([seg], 1250, cutoutCamera).cutoutAmount).toBeCloseTo(0.5);
        expect(resolve([seg], 3000, cutoutCamera).cutoutAmount).toBe(0);
        expect(resolve([{ ...seg, animateOut: false }], 5000, cutoutCamera).cutoutAmount).toBe(0);
        expect(resolve([seg], 6000, cutoutCamera).cutoutAmount).toBe(1);
    });

    it('a block without removeBackground follows the camera setting', () => {
        expect(resolve([block()], 3000, { ...camera, removeBackground: true }).cutoutAmount).toBe(1);
        expect(resolve([block({ removeBackground: true })], 3000).cutoutAmount).toBe(1);
    });
});
