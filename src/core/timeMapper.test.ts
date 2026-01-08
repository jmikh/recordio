import { describe, it, expect } from 'vitest';
import { TimeMapper } from './timeMapper';
import type { OutputWindow } from './types';

describe('TimeMapper', () => {
    it('Case 1: Simple Continuous Window', () => {
        const windows: OutputWindow[] = [
            { id: '1', startMs: 0, endMs: 1000 }
        ];
        const mapper = new TimeMapper(windows);

        // Source -> Output
        expect(mapper.mapSourceToOutputTime(0)).toBe(0);
        expect(mapper.mapSourceToOutputTime(500)).toBe(500);
        expect(mapper.mapSourceToOutputTime(1000)).toBe(1000); // inclusive

        // Output -> Source
        expect(mapper.mapOutputToSourceTime(0)).toBe(0);
        expect(mapper.mapOutputToSourceTime(500)).toBe(500);

        // Duration
        expect(mapper.getOutputDuration()).toBe(1000);
    });

    it('Case 2: Windows with Gap', () => {
        const windows: OutputWindow[] = [
            { id: '1', startMs: 0, endMs: 500 },
            { id: '2', startMs: 1000, endMs: 1500 }
        ];
        const mapper = new TimeMapper(windows);

        // Duration
        expect(mapper.getOutputDuration()).toBe(1000);

        // Source -> Output
        expect(mapper.mapSourceToOutputTime(0)).toBe(0);
        expect(mapper.mapSourceToOutputTime(499)).toBe(499);

        // Gap
        expect(mapper.mapSourceToOutputTime(500)).toBe(500); // edge is inclusive
        expect(mapper.mapSourceToOutputTime(600)).toBe(-1); // in gap
        expect(mapper.mapSourceToOutputTime(999)).toBe(-1); // in gap

        // Second window
        expect(mapper.mapSourceToOutputTime(1000)).toBe(500);
        expect(mapper.mapSourceToOutputTime(1250)).toBe(750);

        // Output -> Source (within total duration)
        // Output 0-500 maps to source 0-500 (first window)
        // Output 500-1000 maps to source 1000-1500 (second window)
        expect(mapper.mapOutputToSourceTime(0)).toBe(0);
        expect(mapper.mapOutputToSourceTime(500)).toBe(1000); // start of second window
        expect(mapper.mapOutputToSourceTime(750)).toBe(1250); // 250ms into second window
    });

    it('Case 4: Range Mapping', () => {
        const windows: OutputWindow[] = [
            { id: '1', startMs: 0, endMs: 500 },
            { id: '2', startMs: 1000, endMs: 2000 }
        ];
        const mapper = new TimeMapper(windows);

        // Sub-case A: Fully inside window
        const r1 = mapper.mapSourceRangeToOutputRange(100, 400);
        expect(r1).not.toBeNull();
        if (r1) {
            expect(r1.start).toBe(100);
            expect(r1.end).toBe(400);
        }

        // Sub-case B: Spanning gap (should clamp)
        const r2 = mapper.mapSourceRangeToOutputRange(100, 1200);
        expect(r2).not.toBeNull();
        if (r2) {
            expect(r2.start).toBe(100);
            expect(r2.end).toBe(500);
        }

        // Sub-case C: Start in gap
        const r3 = mapper.mapSourceRangeToOutputRange(600, 800);
        expect(r3).toBeNull();

        // Sub-case D: Start in second window
        const r4 = mapper.mapSourceRangeToOutputRange(1100, 1200);
        expect(r4).not.toBeNull();
        if (r4) {
            expect(r4.start).toBe(600);
            expect(r4.end).toBe(700);
        }
    });
});
