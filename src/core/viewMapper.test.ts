import { describe, it, expect } from 'vitest';
import { ViewMapper } from './viewMapper';

describe('ViewMapper', () => {
    it('Case 1: 1000x1000 Output, 2000x2000 Input (2x Zoom/Scale)', () => {
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

        // Input to Output Mapping
        // Center of input (1000, 1000) should be center of output (500, 500)
        const p = mapper.inputToOutputPoint({ x: 1000, y: 1000 });
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

    it('Case 2: Letterboxing (Input 2000x1000, Output 1000x1000)', () => {
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

    it('Case 4: Cropping (Input 2000x2000, Crop 1000x1000 centered, Output 1000x1000)', () => {
        const inputSize = { width: 2000, height: 2000 };
        const cropRect = { x: 500, y: 500, width: 1000, height: 1000 };
        const mapper = new ViewMapper(
            inputSize,
            { width: 1000, height: 1000 },
            0,
            cropRect
        );

        // Content Rect should based on CROP size (1000x1000) fitting into Output (1000x1000)
        // Scale should be 1.0 (Crop Width 1000 / Output Width 1000)
        expect(mapper.contentRect.width).toBe(1000);
        expect(mapper.contentRect.height).toBe(1000);

        // Point Inside Crop (Center of Video = 1000,1000)
        // Relative to Crop (x=500, y=500), this point is at 500,500
        // Mapped to Output (1000x1000), it should be at 500,500
        const p1 = mapper.inputToOutputPoint({ x: 1000, y: 1000 });
        expect(p1.x).toBe(500);
        expect(p1.y).toBe(500);
        expect(p1.visible).toBe(true);

        // Point Outside Crop (0,0)
        // Should be clamped to Crop Start (500,500) -> Output (0,0)
        const p2 = mapper.inputToOutputPoint({ x: 0, y: 0 });
        expect(p2.x).toBe(0);
        expect(p2.y).toBe(0);
        expect(p2.visible).toBe(false);

        // Point Outside Crop (2000, 2000)
        // Should be clamped to Crop End (1500, 1500) -> Output (1000, 1000)
        const p3 = mapper.inputToOutputPoint({ x: 2000, y: 2000 });
        expect(p3.x).toBe(1000);
        expect(p3.y).toBe(1000);
        expect(p3.visible).toBe(false);
    });
});
