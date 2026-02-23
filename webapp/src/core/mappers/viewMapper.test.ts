import { describe, it, expect } from 'vitest';
import { ViewMapper } from './viewMapper';

describe('ViewMapper', () => {
    it('Case 1: 1000x1000 Output, 2000x2000 Source (2x Zoom/Scale)', () => {
        const mapper = new ViewMapper(
            { width: 2000, height: 2000 },
            { width: 1000, height: 1000 },
            0
        );

        // Content Rect should fill output
        expect(mapper.contentRect.x).toBe(0);
        expect(mapper.contentRect.y).toBe(0);
        expect(mapper.contentRect.width).toBe(1000);
        expect(mapper.contentRect.height).toBe(1000);

        // Source to Output Mapping
        // Center of source (1000, 1000) should be center of output (500, 500)
        const p = mapper.sourceToOutputPoint({ x: 1000, y: 1000 });
        expect(p.x).toBe(500);
        expect(p.y).toBe(500);
        expect(p.visible).toBe(true);

        // Resolve Render Rects (Full View)
        const fullView = { x: 0, y: 0, width: 1000, height: 1000 };
        const rects = mapper.resolveRenderRects(fullView);
        expect(rects).not.toBeNull();
        if (rects) {
            expect(rects.destRect.x).toBe(0);
            expect(rects.destRect.width).toBe(1000);
            expect(rects.sourceRect.width).toBe(2000);
        }
    });

    it('Case 2: Letterboxing (Source 2000x1000, Output 1000x1000)', () => {
        const mapper2 = new ViewMapper(
            { width: 2000, height: 1000 },
            { width: 1000, height: 1000 },
            0
        );

        expect(mapper2.contentRect.x).toBe(0);
        expect(mapper2.contentRect.y).toBe(250);
        expect(mapper2.contentRect.width).toBe(1000);
        expect(mapper2.contentRect.height).toBe(500);
    });

    it('Case 3: Padding (10% padding)', () => {
        const mapper3 = new ViewMapper(
            { width: 1000, height: 1000 },
            { width: 1000, height: 1000 },
            0.1
        );

        // Content should be 800x800, centered.
        // x = (1000 - 800) / 2 = 100.
        expect(mapper3.contentRect.x).toBe(100);
        expect(mapper3.contentRect.y).toBe(100);
        expect(mapper3.contentRect.width).toBe(800);
    });

    it('Case 4: Cropping (Source 2000x2000, Crop 1000x1000 centered, Output 1000x1000)', () => {
        const sourceSize = { width: 2000, height: 2000 };
        const cropRect = { x: 500, y: 500, width: 1000, height: 1000 };
        const mapper = new ViewMapper(
            sourceSize,
            { width: 1000, height: 1000 },
            0,
            cropRect
        );

        // Content Rect should be based on CROP size (1000x1000) fitting into Output (1000x1000)
        expect(mapper.contentRect.width).toBe(1000);
        expect(mapper.contentRect.height).toBe(1000);

        // Point Inside Crop (Center of Video = 1000,1000)
        // Relative to Crop (x=500, y=500), this point is at 500,500
        const p1 = mapper.sourceToOutputPoint({ x: 1000, y: 1000 });
        expect(p1.x).toBe(500);
        expect(p1.y).toBe(500);
        expect(p1.visible).toBe(true);

        // Point Outside Crop (0,0) → clamped to Crop Start (500,500) → Output (0,0)
        const p2 = mapper.sourceToOutputPoint({ x: 0, y: 0 });
        expect(p2.x).toBe(0);
        expect(p2.y).toBe(0);
        expect(p2.visible).toBe(false);

        // Point Outside Crop (2000, 2000) → clamped to Crop End (1500, 1500) → Output (1000, 1000)
        const p3 = mapper.sourceToOutputPoint({ x: 2000, y: 2000 });
        expect(p3.x).toBe(1000);
        expect(p3.y).toBe(1000);
        expect(p3.visible).toBe(false);
    });

    it('Case 5: Toolbar disabled - no user crop (viewport as reference only)', () => {
        // Full window: 1920x1180, viewport at y=100 (100px toolbar)
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            trackableContentRect,
            false // toolbar disabled
        );

        // With toolbar disabled, no crop is applied → full source is rendered
        // 1920x1180 fit into 1920x1080 → letterboxed
        expect(mapper.contentRect.height).toBe(1080);
        expect(mapper.contentRect.width).toBeLessThan(1920); // Width shrinks to fit aspect ratio

        // sourceToOutputPoint: frame (0,0) = top-left of full frame
        const p2 = mapper.sourceToOutputPoint({ x: 0, y: 0 });
        expect(p2.x).toBeCloseTo(mapper.contentRect.x, 0);
        expect(p2.y).toBeCloseTo(mapper.contentRect.y, 0);
    });

    it('Case 6: Toolbar enabled - no user crop (auto-crops to viewport)', () => {
        // Full window: 1920x1180, viewport at y=100 (100px toolbar)
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            trackableContentRect,
            true // toolbar enabled
        );

        // With toolbar enabled and no crop, effective crop starts at trackableContentRect.y
        // Crop: {x:0, y:100, w:1920, h:1080} + toolbar height on top
        expect(mapper.cropRect).toBeDefined();
        expect(mapper.cropRect!.y).toBe(100);
        expect(mapper.cropRect!.height).toBe(1080);
        expect(mapper.toolbarOutputHeight).toBeGreaterThan(0);
    });

    it('Case 7: projectSourceToOutput rect-based projection', () => {
        const mapper = new ViewMapper(
            { width: 1000, height: 1000 },
            { width: 1000, height: 1000 },
            0
        );

        const viewport = { x: 0, y: 0, width: 1000, height: 1000 };
        const sourceRect = { x: 250, y: 250, width: 500, height: 500 };
        const result = mapper.projectSourceToOutput(sourceRect, viewport);

        expect(result.x).toBeCloseTo(250, 0);
        expect(result.y).toBeCloseTo(250, 0);
        expect(result.width).toBeCloseTo(500, 0);
        expect(result.height).toBeCloseTo(500, 0);
    });

    it('Case 8: projectEventToOutput applies offset (toolbar disabled)', () => {
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            trackableContentRect,
            false // toolbar disabled
        );

        // eventToOutputPoint: viewport coord (0,0) → frame (0,100)
        const p1 = mapper.eventToOutputPoint({ x: 0, y: 0 });
        // The frame coord (0, 100) should be slightly below the top of output
        expect(p1.y).toBeGreaterThan(0);
    });

    it('Case 9: Toolbar enabled + user crop includes toolbar area → auto-clamp', () => {
        // Full window: 1920x1180, viewport at y=100 (100px toolbar)
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        // User's crop starts at y=50 (includes part of toolbar)
        const userCrop = { x: 0, y: 50, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            userCrop,
            trackableContentRect,
            true
        );

        // Effective crop should be clamped to y=100 (trackableContentRect.y), losing 50px
        expect(mapper.cropRect!.y).toBe(100);
        expect(mapper.cropRect!.height).toBe(1030); // 1080 - 50 lost
        expect(mapper.toolbarOutputHeight).toBeGreaterThan(0);
    });

    it('Case 10: Toolbar enabled + user crop already excludes toolbar → use as-is', () => {
        // Full window: 1920x1180, viewport at y=100
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        // User crop starts below toolbar (at y=200), cropping into content
        const userCrop = { x: 100, y: 200, width: 1600, height: 800 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            userCrop,
            trackableContentRect,
            true
        );

        // User's crop already excludes toolbar, so use as-is
        expect(mapper.cropRect!.x).toBe(100);
        expect(mapper.cropRect!.y).toBe(200);
        expect(mapper.cropRect!.width).toBe(1600);
        expect(mapper.cropRect!.height).toBe(800);
        expect(mapper.toolbarOutputHeight).toBeGreaterThan(0);
    });

    it('Case 11: Toolbar disabled + user crop → use crop as-is, no toolbar', () => {
        const trackableContentRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const userCrop = { x: 100, y: 50, width: 1600, height: 900 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            userCrop,
            trackableContentRect,
            false
        );

        // Toolbar disabled: user crop used as-is, no clamping, no toolbar
        expect(mapper.cropRect!.x).toBe(100);
        expect(mapper.cropRect!.y).toBe(50);
        expect(mapper.cropRect!.width).toBe(1600);
        expect(mapper.cropRect!.height).toBe(900);
        expect(mapper.toolbarOutputHeight).toBe(0);
    });

    // Standard 9-slice config matching defineFrame()
    const STANDARD_SCALING = {
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

    it('Case 12: Device frame — screen aspect matches video aspect', () => {
        const frame = {
            id: 'test-frame',
            name: 'Test',
            imageUrl: '',
            thumbnailUrl: '',
            size: { width: 100, height: 80 },
            screenRect: { x: 10, y: 10, width: 80, height: 60 },
            customScaling: STANDARD_SCALING,
        };

        const mapper = new ViewMapper(
            { width: 800, height: 600 },
            { width: 1000, height: 800 },
            0,
            undefined,
            undefined,
            true,
            frame
        );

        expect(mapper.frameRect).toBeDefined();
        // Screen aspect should match video aspect (4:3)
        const screenAspect = mapper.contentRect.width / mapper.contentRect.height;
        expect(screenAspect).toBeCloseTo(4 / 3, 2);
    });

    it('Case 13: Device frame with padding — frame is inset', () => {
        const frame = {
            id: 'test-frame',
            name: 'Test',
            imageUrl: '',
            thumbnailUrl: '',
            size: { width: 100, height: 80 },
            screenRect: { x: 10, y: 10, width: 80, height: 60 },
            customScaling: STANDARD_SCALING,
        };

        const mapper = new ViewMapper(
            { width: 800, height: 600 },
            { width: 1000, height: 800 },
            0.1,
            undefined,
            undefined,
            true,
            frame
        );

        expect(mapper.frameRect).toBeDefined();
        // Frame should be smaller than output (padding applied)
        expect(mapper.frameRect!.width).toBeLessThanOrEqual(800);
        expect(mapper.frameRect!.height).toBeLessThanOrEqual(640);
        // Frame should be centered
        const frameCenterX = mapper.frameRect!.x + mapper.frameRect!.width / 2;
        expect(frameCenterX).toBeCloseTo(500, 0);
    });

    it('Case 14: Device frame stretches for different video aspect — no white space', () => {
        const frame = {
            id: 'macbook-test',
            name: 'MacBook Test',
            imageUrl: '',
            thumbnailUrl: '',
            size: { width: 100, height: 80 },
            screenRect: { x: 10, y: 10, width: 80, height: 60 },
            customScaling: STANDARD_SCALING,
        };

        // 16:9 video content (different from frame's 4:3 screen)
        const mapper = new ViewMapper(
            { width: 1920, height: 1080 },
            { width: 1000, height: 1000 },
            0,
            undefined,
            undefined,
            true,
            frame
        );

        expect(mapper.frameRect).toBeDefined();
        // Video completely fills the screen area (no white space)
        const screenAspect = mapper.contentRect.width / mapper.contentRect.height;
        expect(screenAspect).toBeCloseTo(16 / 9, 2);
    });
});
