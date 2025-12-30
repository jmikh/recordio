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
});
