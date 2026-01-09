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

    it('Case 4: Range Mapping with Partial Visibility', () => {
        const windows: OutputWindow[] = [
            { id: '1', startMs: 0, endMs: 500 },
            { id: '2', startMs: 1000, endMs: 2000 }
        ];
        const mapper = new TimeMapper(windows);

        // Sub-case A: Fully inside window
        // Source 100-400 is in Window 1 (0-500)
        // Output offset 0.
        // Expect Output 100-400.
        const r1 = mapper.mapSourceRangeToOutputRange(100, 400);
        expect(r1).toEqual({ start: 100, end: 400 });

        // Sub-case B: Spanning gap (Gap is 500-1000)
        // Source 400-1100.
        // Window 1: 400-500. Output 400-500.
        // Window 2: 1000-1100. Output 500 + (1000-1000) to 500 + (1100-1000) = 500-600.
        // Overall: starts at 400, ends at 600.
        // User wants: "return any visible range".
        const r2 = mapper.mapSourceRangeToOutputRange(400, 1100);
        expect(r2).toEqual({ start: 400, end: 600 });

        // Sub-case C: Start in gap, End in window
        // Source 600-1200.
        // 600 is in Gap (500-1000).
        // First visible part starts at 1000 (Window 2 start).
        // Window 2 maps 1000 to Output 500.
        // End is 1200. Window 2 maps 1200 to Output 500 + 200 = 700.
        // Expect: 500-700.
        const r3 = mapper.mapSourceRangeToOutputRange(600, 1200);
        expect(r3).toEqual({ start: 500, end: 700 });

        // Sub-case D: Start in window, End in gap
        // Source 400-800.
        // Start 400 is Window 1. Output 400.
        // End 800 is Gap (500-1000).
        // Last visible part ends at 500 (Window 1 end). Output 500.
        // Expect: 400-500.
        const r4 = mapper.mapSourceRangeToOutputRange(400, 800);
        expect(r4).toEqual({ start: 400, end: 500 });

        // Sub-case E: Fully in gap
        // Source 600-800.
        // No intersection.
        // Expect: null.
        const r5 = mapper.mapSourceRangeToOutputRange(600, 800);
        expect(r5).toBeNull();

        // Sub-case F: Point event in gap
        const r6 = mapper.mapSourceRangeToOutputRange(600, undefined);
        expect(r6).toBeNull();

        // Sub-case G: Point event valid
        const r7 = mapper.mapSourceRangeToOutputRange(200, undefined);
        expect(r7).toEqual({ start: 200, end: 200 });

        // Sub-case H: Multi-gap span
        // Windows: [0-500], [1000-2000]. Add a third?
        // Let's assume current windows.
        // Source: 0-2000.
        // Visible: 0-500 (Output 0-500), 1000-2000 (Output 500-1500).
        // Expect: 0-1500.
        const r8 = mapper.mapSourceRangeToOutputRange(0, 2000);
        expect(r8).toEqual({ start: 0, end: 1500 });
    });
});
