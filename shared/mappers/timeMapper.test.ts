import { describe, it, expect } from 'vitest';
import { TimeMapper, recomputeOutputTimes } from './timeMapper';
import type { OutputWindow, TimeSegment } from '../types';

// ==========================================
// Helpers
// ==========================================

function win(startMs: number, endMs: number, speed = 1): OutputWindow {
    return { id: `w-${startMs}-${endMs}`, startMs, endMs, speed };
}

function seg(id: string, start: number, end: number): TimeSegment {
    return {
        id,
        sourceStartTimeMs: start,
        sourceEndTimeMs: end,
        outputStartTimeMs: -1,
        outputEndTimeMs: -1,
        visible: false,
    };
}

// ==========================================
// getOutputDuration
// ==========================================

describe('TimeMapper.getOutputDuration', () => {
    it('single window at 1x', () => {
        const m = new TimeMapper([win(0, 1000)]);
        expect(m.getOutputDuration()).toBe(1000);
    });

    it('single window at 2x speed halves duration', () => {
        const m = new TimeMapper([win(0, 1000, 2)]);
        expect(m.getOutputDuration()).toBe(500);
    });

    it('single window at 0.5x speed doubles duration', () => {
        const m = new TimeMapper([win(0, 1000, 0.5)]);
        expect(m.getOutputDuration()).toBe(2000);
    });

    it('multiple windows sum durations', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);
        expect(m.getOutputDuration()).toBe(1000);
    });

    it('multiple windows with different speeds', () => {
        // 500ms at 1x = 500, 500ms at 2x = 250
        const m = new TimeMapper([win(0, 500, 1), win(1000, 1500, 2)]);
        expect(m.getOutputDuration()).toBe(750);
    });

    it('empty windows = 0 duration', () => {
        const m = new TimeMapper([]);
        expect(m.getOutputDuration()).toBe(0);
    });
});

// ==========================================
// mapSourceToOutputTime
// ==========================================

describe('TimeMapper.mapSourceToOutputTime', () => {
    describe('single continuous window', () => {
        const m = new TimeMapper([win(0, 1000)]);

        it('start of window', () => expect(m.mapSourceToOutputTime(0)).toBe(0));
        it('middle of window', () => expect(m.mapSourceToOutputTime(500)).toBe(500));
        it('end of window (inclusive)', () => expect(m.mapSourceToOutputTime(1000)).toBe(1000));
    });

    describe('windows with gap', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);

        it('start of first window', () => expect(m.mapSourceToOutputTime(0)).toBe(0));
        it('end of first window', () => expect(m.mapSourceToOutputTime(500)).toBe(500));
        it('in gap returns -1', () => expect(m.mapSourceToOutputTime(600)).toBe(-1));
        it('just before second window returns -1', () => expect(m.mapSourceToOutputTime(999)).toBe(-1));
        it('start of second window', () => expect(m.mapSourceToOutputTime(1000)).toBe(500));
        it('middle of second window', () => expect(m.mapSourceToOutputTime(1250)).toBe(750));
        it('end of second window', () => expect(m.mapSourceToOutputTime(1500)).toBe(1000));
    });

    describe('before/after all windows', () => {
        const m = new TimeMapper([win(100, 200)]);

        it('before first window returns -1', () => expect(m.mapSourceToOutputTime(50)).toBe(-1));
        it('after last window returns -1', () => expect(m.mapSourceToOutputTime(300)).toBe(-1));
        it('negative time returns -1', () => expect(m.mapSourceToOutputTime(-100)).toBe(-1));
    });

    describe('speed variations', () => {
        it('2x speed: 500ms source → 250ms output', () => {
            const m = new TimeMapper([win(0, 1000, 2)]);
            expect(m.mapSourceToOutputTime(500)).toBe(250);
        });

        it('0.5x speed: 500ms source → 1000ms output', () => {
            const m = new TimeMapper([win(0, 1000, 0.5)]);
            expect(m.mapSourceToOutputTime(500)).toBe(1000);
        });

        it('mixed speeds across windows', () => {
            // win1: 0-500 at 2x → 250ms output. win2: 1000-2000 at 0.5x → 2000ms output.
            const m = new TimeMapper([win(0, 500, 2), win(1000, 2000, 0.5)]);

            // source 250 in win1 at 2x → output 125
            expect(m.mapSourceToOutputTime(250)).toBe(125);
            // source 1000 in win2 → output starts at 250 (after win1)
            expect(m.mapSourceToOutputTime(1000)).toBe(250);
            // source 1500 in win2 at 0.5x → 250 + (500 / 0.5) = 250 + 1000 = 1250
            expect(m.mapSourceToOutputTime(1500)).toBe(1250);
        });
    });

    describe('three windows with two gaps', () => {
        const m = new TimeMapper([win(0, 100), win(200, 300), win(500, 600)]);

        it('in first window', () => expect(m.mapSourceToOutputTime(50)).toBe(50));
        it('in first gap', () => expect(m.mapSourceToOutputTime(150)).toBe(-1));
        it('in second window', () => expect(m.mapSourceToOutputTime(250)).toBe(150));
        it('in second gap', () => expect(m.mapSourceToOutputTime(400)).toBe(-1));
        it('in third window', () => expect(m.mapSourceToOutputTime(550)).toBe(250));
    });

    describe('empty windows', () => {
        const m = new TimeMapper([]);
        it('any time returns -1', () => expect(m.mapSourceToOutputTime(0)).toBe(-1));
    });
});

// ==========================================
// mapOutputToSourceTime
// ==========================================

describe('TimeMapper.mapOutputToSourceTime', () => {
    describe('single window at 1x', () => {
        const m = new TimeMapper([win(0, 1000)]);

        it('start', () => expect(m.mapOutputToSourceTime(0)).toBe(0));
        it('middle', () => expect(m.mapOutputToSourceTime(500)).toBe(500));
        it('exact end (inclusive)', () => expect(m.mapOutputToSourceTime(1000)).toBe(1000));
        it('past end returns -1', () => expect(m.mapOutputToSourceTime(1001)).toBe(-1));
    });

    describe('negative output time', () => {
        const m = new TimeMapper([win(0, 1000)]);
        it('returns -1', () => expect(m.mapOutputToSourceTime(-1)).toBe(-1));
    });

    describe('windows with gap', () => {
        // win1: 0-500 (output 0-500), win2: 1000-1500 (output 500-1000)
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);

        it('output 0 → source 0', () => expect(m.mapOutputToSourceTime(0)).toBe(0));
        it('output 250 → source 250', () => expect(m.mapOutputToSourceTime(250)).toBe(250));
        it('output 500 → source 1000 (second window start)', () => expect(m.mapOutputToSourceTime(500)).toBe(1000));
        it('output 750 → source 1250', () => expect(m.mapOutputToSourceTime(750)).toBe(1250));
        it('output 1000 → source 1500 (exact end)', () => expect(m.mapOutputToSourceTime(1000)).toBe(1500));
        it('output 1001 → -1 (past end)', () => expect(m.mapOutputToSourceTime(1001)).toBe(-1));
    });

    describe('speed variations', () => {
        it('2x speed: output 250 → source 500', () => {
            const m = new TimeMapper([win(0, 1000, 2)]);
            expect(m.mapOutputToSourceTime(250)).toBe(500);
        });

        it('0.5x speed: output 1000 → source 500', () => {
            const m = new TimeMapper([win(0, 1000, 0.5)]);
            expect(m.mapOutputToSourceTime(1000)).toBe(500);
        });

        it('mixed speeds: output maps through correct windows', () => {
            // win1: 0-600 at 2x → 300ms output. win2: 1000-1200 at 0.5x → 400ms output.
            const m = new TimeMapper([win(0, 600, 2), win(1000, 1200, 0.5)]);

            // output 150 → in win1 at 2x → source = 150 * 2 = 300
            expect(m.mapOutputToSourceTime(150)).toBe(300);
            // output 300 → start of win2 → source 1000
            expect(m.mapOutputToSourceTime(300)).toBe(1000);
            // output 500 → 200ms into win2 at 0.5x → source = 1000 + (200 * 0.5) = 1100
            expect(m.mapOutputToSourceTime(500)).toBe(1100);
        });
    });

    describe('window not starting at 0', () => {
        const m = new TimeMapper([win(500, 1500)]);

        it('output 0 → source 500', () => expect(m.mapOutputToSourceTime(0)).toBe(500));
        it('output 500 → source 1000', () => expect(m.mapOutputToSourceTime(500)).toBe(1000));
        it('output 1000 → source 1500 (exact end)', () => expect(m.mapOutputToSourceTime(1000)).toBe(1500));
    });

    describe('empty windows', () => {
        const m = new TimeMapper([]);
        it('output 0 returns -1', () => expect(m.mapOutputToSourceTime(0)).toBe(-1));
    });
});

// ==========================================
// getWindowAtOutputTime
// ==========================================

describe('TimeMapper.getWindowAtOutputTime', () => {
    it('returns window containing the time', () => {
        const w = win(0, 1000);
        const m = new TimeMapper([w]);
        const result = m.getWindowAtOutputTime(500);
        expect(result).not.toBeNull();
        expect(result!.window).toBe(w);
        expect(result!.outputStartMs).toBe(0);
    });

    it('returns correct window and offset with gap', () => {
        const w1 = win(0, 500);
        const w2 = win(1000, 1500);
        const m = new TimeMapper([w1, w2]);

        // output 250 → in w1
        const r1 = m.getWindowAtOutputTime(250);
        expect(r1!.window).toBe(w1);
        expect(r1!.outputStartMs).toBe(0);

        // output 750 → in w2 (w2 starts at output 500)
        const r2 = m.getWindowAtOutputTime(750);
        expect(r2!.window).toBe(w2);
        expect(r2!.outputStartMs).toBe(500);
    });

    it('boundary between windows: exact end of w1 goes to w2', () => {
        const w1 = win(0, 500);
        const w2 = win(1000, 1500);
        const m = new TimeMapper([w1, w2]);

        // output 500 = exact end of w1's output range → falls in w2
        const r = m.getWindowAtOutputTime(500);
        expect(r!.window).toBe(w2);
    });

    it('output time = 0', () => {
        const w = win(100, 200);
        const m = new TimeMapper([w]);
        const r = m.getWindowAtOutputTime(0);
        expect(r!.window).toBe(w);
    });

    it('past end returns null', () => {
        const m = new TimeMapper([win(0, 1000)]);
        expect(m.getWindowAtOutputTime(1000)).toBeNull();
    });

    it('negative time returns null', () => {
        const m = new TimeMapper([win(0, 1000)]);
        expect(m.getWindowAtOutputTime(-1)).toBeNull();
    });

    it('empty windows returns null', () => {
        const m = new TimeMapper([]);
        expect(m.getWindowAtOutputTime(0)).toBeNull();
    });

    it('with speed: correct window found at scaled time', () => {
        const w = win(0, 1000, 2); // 1000ms source → 500ms output
        const m = new TimeMapper([w]);

        expect(m.getWindowAtOutputTime(250)).not.toBeNull();
        expect(m.getWindowAtOutputTime(499)).not.toBeNull();
        expect(m.getWindowAtOutputTime(500)).toBeNull(); // past output duration
    });
});

// ==========================================
// mapSourceRangeToOutputRange
// ==========================================

describe('TimeMapper.mapSourceRangeToOutputRange', () => {
    describe('single window', () => {
        const m = new TimeMapper([win(0, 1000)]);

        it('fully inside', () => {
            expect(m.mapSourceRangeToOutputRange(100, 400)).toEqual({ start: 100, end: 400 });
        });

        it('exact window bounds', () => {
            expect(m.mapSourceRangeToOutputRange(0, 1000)).toEqual({ start: 0, end: 1000 });
        });

        it('extends past window end — clamped', () => {
            expect(m.mapSourceRangeToOutputRange(500, 2000)).toEqual({ start: 500, end: 1000 });
        });

        it('starts before offset window — clamped to visible', () => {
            const m2 = new TimeMapper([win(100, 500)]);
            expect(m2.mapSourceRangeToOutputRange(0, 300)).toEqual({ start: 0, end: 200 });
        });
    });

    describe('windows with gap', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 2000)]);

        it('fully in first window', () => {
            expect(m.mapSourceRangeToOutputRange(100, 400)).toEqual({ start: 100, end: 400 });
        });

        it('fully in second window', () => {
            // second window output starts at 500
            expect(m.mapSourceRangeToOutputRange(1200, 1800)).toEqual({ start: 700, end: 1300 });
        });

        it('spanning gap', () => {
            // 400-1100: visible in win1 400-500, win2 1000-1100
            expect(m.mapSourceRangeToOutputRange(400, 1100)).toEqual({ start: 400, end: 600 });
        });

        it('start in gap, end in window', () => {
            expect(m.mapSourceRangeToOutputRange(600, 1200)).toEqual({ start: 500, end: 700 });
        });

        it('start in window, end in gap', () => {
            expect(m.mapSourceRangeToOutputRange(400, 800)).toEqual({ start: 400, end: 500 });
        });

        it('fully in gap returns null', () => {
            expect(m.mapSourceRangeToOutputRange(600, 800)).toBeNull();
        });

        it('entire timeline', () => {
            expect(m.mapSourceRangeToOutputRange(0, 2000)).toEqual({ start: 0, end: 1500 });
        });
    });

    describe('three windows', () => {
        const m = new TimeMapper([win(0, 100), win(200, 300), win(500, 600)]);
        // Output: 0-100, 100-200, 200-300 (total 300)

        it('spanning all three windows', () => {
            expect(m.mapSourceRangeToOutputRange(0, 600)).toEqual({ start: 0, end: 300 });
        });

        it('spanning windows 2 and 3', () => {
            expect(m.mapSourceRangeToOutputRange(250, 550)).toEqual({ start: 150, end: 250 });
        });
    });

    describe('point events (sourceEndTimeMs undefined)', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);

        it('point in window', () => {
            expect(m.mapSourceRangeToOutputRange(200, undefined)).toEqual({ start: 200, end: 200 });
        });

        it('point in gap returns null', () => {
            expect(m.mapSourceRangeToOutputRange(600, undefined)).toBeNull();
        });

        it('point at window boundary (inclusive)', () => {
            expect(m.mapSourceRangeToOutputRange(500, undefined)).toEqual({ start: 500, end: 500 });
        });
    });

    describe('zero-duration range (start === end)', () => {
        const m = new TimeMapper([win(0, 1000)]);

        it('treated as point event', () => {
            expect(m.mapSourceRangeToOutputRange(500, 500)).toEqual({ start: 500, end: 500 });
        });
    });

    describe('with speed', () => {
        it('range in 2x window', () => {
            const m = new TimeMapper([win(0, 1000, 2)]);
            // source 200-600 → output (200/2)-(600/2) = 100-300
            expect(m.mapSourceRangeToOutputRange(200, 600)).toEqual({ start: 100, end: 300 });
        });

        it('range spanning gap with different speeds', () => {
            // win1: 0-500 at 2x → 250ms output. win2: 1000-2000 at 0.5x → 2000ms output.
            const m = new TimeMapper([win(0, 500, 2), win(1000, 2000, 0.5)]);

            // source 400-1200:
            // win1: 400-500 → output (400/2)-(500/2) = 200-250
            // win2: 1000-1200 → output 250 + (0/0.5) to 250 + (200/0.5) = 250-650
            // overall: 200-650
            expect(m.mapSourceRangeToOutputRange(400, 1200)).toEqual({ start: 200, end: 650 });
        });
    });
});

// ==========================================
// recomputeOutputTimes
// ==========================================

describe('recomputeOutputTimes', () => {
    it('stamps visible segments with output times', () => {
        const m = new TimeMapper([win(0, 1000)]);
        const segments = [seg('s1', 100, 400), seg('s2', 600, 900)];

        const result = recomputeOutputTimes(segments, m);

        expect(result[0].outputStartTimeMs).toBe(100);
        expect(result[0].outputEndTimeMs).toBe(400);
        expect(result[0].visible).toBe(true);

        expect(result[1].outputStartTimeMs).toBe(600);
        expect(result[1].outputEndTimeMs).toBe(900);
        expect(result[1].visible).toBe(true);
    });

    it('marks segments in gaps as not visible', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);
        const segments = [seg('s1', 600, 800)]; // fully in gap

        const result = recomputeOutputTimes(segments, m);
        expect(result[0].outputStartTimeMs).toBe(-1);
        expect(result[0].outputEndTimeMs).toBe(-1);
        expect(result[0].visible).toBe(false);
    });

    it('handles segments spanning gaps', () => {
        const m = new TimeMapper([win(0, 500), win(1000, 1500)]);
        const segments = [seg('s1', 400, 1100)]; // spans gap

        const result = recomputeOutputTimes(segments, m);
        expect(result[0].outputStartTimeMs).toBe(400);
        expect(result[0].outputEndTimeMs).toBe(600); // 500 + (1100-1000)
        expect(result[0].visible).toBe(true);
    });

    it('does not mutate original segments', () => {
        const m = new TimeMapper([win(0, 1000)]);
        const original = seg('s1', 100, 200);
        const segments = [original];

        const result = recomputeOutputTimes(segments, m);
        expect(result[0]).not.toBe(original);
        expect(original.outputStartTimeMs).toBe(-1); // unchanged
    });

    it('empty segments array returns empty', () => {
        const m = new TimeMapper([win(0, 1000)]);
        expect(recomputeOutputTimes([], m)).toEqual([]);
    });
});

// ==========================================
// Bidirectional consistency
// ==========================================

describe('source↔output roundtrip consistency', () => {
    const cases: { name: string; windows: OutputWindow[] }[] = [
        { name: 'single window', windows: [win(0, 5000)] },
        { name: 'two windows with gap', windows: [win(0, 2000), win(3000, 5000)] },
        { name: '2x speed', windows: [win(0, 4000, 2)] },
        { name: 'mixed speeds', windows: [win(0, 1000, 1), win(2000, 3000, 2), win(4000, 5000, 0.5)] },
    ];

    for (const { name, windows } of cases) {
        it(`${name}: source→output→source roundtrip`, () => {
            const m = new TimeMapper(windows);
            const lastWindow = windows[windows.length - 1];
            for (const w of windows) {
                // Test several points within each window.
                // Skip non-last window endMs: mapSourceToOutputTime treats endMs as inclusive,
                // but mapOutputToSourceTime at that output time resolves to the next window's start.
                const points = [w.startMs, (w.startMs + w.endMs) / 2];
                if (w === lastWindow) points.push(w.endMs);
                for (const srcTime of points) {
                    const outTime = m.mapSourceToOutputTime(srcTime);
                    if (outTime === -1) continue;
                    const backToSource = m.mapOutputToSourceTime(outTime);
                    expect(backToSource).toBeCloseTo(srcTime, 5);
                }
            }
        });
    }
});
