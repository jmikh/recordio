import { describe, it, expect } from 'vitest';
import { getCameraAnchor, scaleCameraSettings, getCameraStateAtTime } from './cameraAnimator';
import type { ZoomSegment, ZoomSettings, Rect } from '../types';

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
