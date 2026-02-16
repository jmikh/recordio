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

    it('Case 5: Viewport offset - hide mode (toolbar hidden, viewport as crop)', () => {
        // Full window: 1920x1180, viewport at y=100 (100px toolbar)
        const viewportRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            viewportRect,
            'hide' // default
        );

        // In 'hide' mode, viewport acts as a crop
        expect(mapper.contentRect.width).toBe(1920);
        expect(mapper.contentRect.height).toBe(1080);

        // eventToOutputPoint: viewport coord (0,0) → frame (0,100) → crop-relative (0,0) → output (0,0)
        const p1 = mapper.eventToOutputPoint({ x: 0, y: 0 });
        expect(p1.x).toBeCloseTo(0, 0);
        expect(p1.y).toBeCloseTo(0, 0);

        // eventToOutputPoint: viewport center (960, 540) → frame (960, 640) → output (960, 540)
        const p2 = mapper.eventToOutputPoint({ x: 960, y: 540 });
        expect(p2.x).toBeCloseTo(960, 0);
        expect(p2.y).toBeCloseTo(540, 0);

        // sourceToOutputPoint (frame geometry): frame (0, 100) = top of viewport crop
        // → crop-relative (0, 0) → output (0, 0)
        const p3 = mapper.sourceToOutputPoint({ x: 0, y: 100 });
        expect(p3.x).toBeCloseTo(0, 0);
        expect(p3.y).toBeCloseTo(0, 0);
    });

    it('Case 6: Viewport offset - show mode (full frame visible)', () => {
        // Full window: 1920x1180, viewport at y=100 (toolbar visible)
        const viewportRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            viewportRect,
            'show'
        );

        // In 'show' mode, full frame is the input (no crop from viewport)
        // 1920x1180 input fit into 1920x1080 output → height-limited
        expect(mapper.contentRect.height).toBe(1080);
        expect(mapper.contentRect.width).toBeLessThan(1920); // Width shrinks to fit aspect ratio

        // eventToOutputPoint: viewport (0,0) → frame (0,100)
        const p1 = mapper.eventToOutputPoint({ x: 0, y: 0 });
        // The frame coord (0, 100) should be slightly below the top of output
        expect(p1.y).toBeGreaterThan(0);

        // sourceToOutputPoint: frame (0,0) = top-left of full frame (no offset applied)
        const p2 = mapper.sourceToOutputPoint({ x: 0, y: 0 });
        // Should be at top-left of content rect (has pillarbox + letterbox padding)
        expect(p2.x).toBeCloseTo(mapper.contentRect.x, 0);
        expect(p2.y).toBeCloseTo(mapper.contentRect.y, 0);
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

    it('Case 8: projectEventToOutput applies offset', () => {
        const viewportRect = { x: 0, y: 100, width: 1920, height: 1080 };
        const mapper = new ViewMapper(
            { width: 1920, height: 1180 },
            { width: 1920, height: 1080 },
            0,
            undefined,
            viewportRect,
            'hide'
        );

        const viewport = { x: 0, y: 0, width: 1920, height: 1080 };
        // Event rect at (100, 200) in viewport coords, 400x300
        const eventRect = { x: 100, y: 200, width: 400, height: 300 };
        const result = mapper.projectEventToOutput(eventRect, viewport);

        // In hide mode, viewport IS the crop (1920x1080 → 1920x1080 output, scale 1:1)
        // Event (100, 200) → frame (100, 300) → crop-relative (100, 200) → output (100, 200)
        expect(result.x).toBeCloseTo(100, 0);
        expect(result.y).toBeCloseTo(200, 0);
        expect(result.width).toBeCloseTo(400, 0);
        expect(result.height).toBeCloseTo(300, 0);
    });
});
