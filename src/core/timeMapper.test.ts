import { describe, it, expect } from 'vitest';
import { TimeMapper } from './timeMapper';
import type { OutputWindow } from './types';

describe('TimeMapper', () => {
    it('Case 1: Simple Continuous Window', () => {
        const windows: OutputWindow[] = [
            { id: '1', startMs: 0, endMs: 1000 }
        ];
        const mapper = new TimeMapper(windows);

        // Timeline -> Output
        expect(mapper.mapTimelineToOutputTime(0)).toBe(0);
        expect(mapper.mapTimelineToOutputTime(500)).toBe(500);
        expect(mapper.mapTimelineToOutputTime(1000)).toBe(-1);

        // Output -> Timeline
        expect(mapper.mapOutputToTimelineTime(0)).toBe(0);
        expect(mapper.mapOutputToTimelineTime(500)).toBe(500);

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

        // Timeline -> Output
        expect(mapper.mapTimelineToOutputTime(0)).toBe(0);
        expect(mapper.mapTimelineToOutputTime(499)).toBe(499);

        // Gap
        expect(mapper.mapTimelineToOutputTime(500)).toBe(-1);
        expect(mapper.mapTimelineToOutputTime(999)).toBe(-1);

        // Second window
        expect(mapper.mapTimelineToOutputTime(1000)).toBe(500);
        expect(mapper.mapTimelineToOutputTime(1250)).toBe(750);

        // Output -> Timeline
        expect(mapper.mapOutputToTimelineTime(0)).toBe(0);
        expect(mapper.mapOutputToTimelineTime(500)).toBe(1000);
        expect(mapper.mapOutputToTimelineTime(750)).toBe(1250);
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
