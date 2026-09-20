import { describe, it, expect } from 'vitest';
import { EventType, type BaseEvent, type UserEvents } from '@shared/types';
import { getAllFocusAreas } from './focusManager';

// ============================================================================
// Helpers
// ============================================================================

const SOURCE_SIZE = { width: 1920, height: 1080 };
const MOUSE_POS = { x: 150, y: 150 };
const TARGET_RECT = { x: 100, y: 100, width: 200, height: 150 };

function emptyEvents(): UserEvents {
    return {
        mouseClicks: [],
        mousePositions: [],
        keyboardEvents: [],
        drags: [],
        scrolls: [],
        typingEvents: [],
        urlChanges: [],
        hoveredCards: [],
    };
}

const point = (type: BaseEvent['type'], timestamp: number): BaseEvent =>
    ({ type, timestamp, mousePos: MOUSE_POS, targetRect: TARGET_RECT });

const range = (type: BaseEvent['type'], timestamp: number, endTime: number): BaseEvent =>
    ({ type, timestamp, endTime, mousePos: MOUSE_POS, targetRect: TARGET_RECT });

/**
 * Asserts the contract FocusManager owes its consumers: areas arrive sorted by
 * start time, never overlap, and are never inverted. autoZoom's
 * toOutputFocusAreas and the debug overlay both rely on this.
 */
function expectSortedNonOverlapping(areas: ReturnType<typeof getAllFocusAreas>, context = '') {
    for (let i = 0; i < areas.length; i++) {
        const a = areas[i];
        const where = `${context}area ${i} (${a.reason}) ${a.sourceStartTimeMs}..${a.sourceEndTimeMs}`;

        expect(a.sourceEndTimeMs, `${where} is inverted`).toBeGreaterThanOrEqual(a.sourceStartTimeMs);

        if (i === 0) continue;
        const prev = areas[i - 1];
        expect(a.sourceStartTimeMs, `${where} starts before previous (${prev.reason})`)
            .toBeGreaterThanOrEqual(prev.sourceStartTimeMs);
        expect(a.sourceStartTimeMs, `${where} overlaps previous (${prev.reason}) ending ${prev.sourceEndTimeMs}`)
            .toBeGreaterThanOrEqual(prev.sourceEndTimeMs);
    }
}

// ============================================================================
// Contract
// ============================================================================

describe('getAllFocusAreas — sorted, non-overlapping contract', () => {
    const DURATION = 10_000;

    it('drops range events that begin past the end of the source', () => {
        // The first typing event is still running when the source ends; the second
        // begins after it entirely. Clamping only the end would emit 11000..10000.
        const events = emptyEvents();
        events.typingEvents = [
            range(EventType.TYPING, 9_500, 12_000),
            range(EventType.TYPING, 11_000, 13_000),
        ];

        const areas = getAllFocusAreas(events, SOURCE_SIZE, DURATION);

        expect(areas.map(a => [a.sourceStartTimeMs, a.sourceEndTimeMs])).toEqual([[9_500, 10_000]]);
        expectSortedNonOverlapping(areas);
    });

    it('drops events pushed past the end by the scroll cooldown', () => {
        // The scroll ends at 9900, so the cooldown puts currentSourceTime at 10901 —
        // past the source end. The typing event that survives it must not be emitted.
        const events = emptyEvents();
        events.scrolls = [range(EventType.SCROLL, 9_000, 9_900)];
        events.typingEvents = [range(EventType.TYPING, 9_950, 14_000)];

        const areas = getAllFocusAreas(events, SOURCE_SIZE, DURATION);

        expect(areas.map(a => [a.reason, a.sourceStartTimeMs, a.sourceEndTimeMs]))
            .toEqual([[EventType.SCROLL, 9_000, 9_900]]);
        expectSortedNonOverlapping(areas);
    });

    it('ignores events during the cooldown but resumes a range that outlives it', () => {
        const events = emptyEvents();
        events.scrolls = [range(EventType.SCROLL, 1_000, 2_000)];
        // Click lands inside the cooldown (2001..3001) — dropped.
        events.mouseClicks = [point(EventType.CLICK, 2_500)];
        // Typing starts inside the cooldown but runs past it — resumes at its end.
        events.typingEvents = [range(EventType.TYPING, 2_600, 6_000)];

        const areas = getAllFocusAreas(events, SOURCE_SIZE, DURATION);

        expect(areas.map(a => a.reason)).toEqual([EventType.SCROLL, EventType.TYPING]);
        expect(areas[1].sourceStartTimeMs).toBe(3_001);
        expect(areas[1].sourceEndTimeMs).toBe(6_000);
        expectSortedNonOverlapping(areas);
    });

    it('gives a click a lead-in ending on the click itself', () => {
        const events = emptyEvents();
        events.mouseClicks = [point(EventType.CLICK, 5_000)];

        const areas = getAllFocusAreas(events, SOURCE_SIZE, DURATION);

        expect(areas).toHaveLength(1);
        expect(areas[0].sourceStartTimeMs).toBe(4_500);
        expect(areas[0].sourceEndTimeMs).toBe(5_000);
    });

    it("never starts a click's lead-in before the previous area ended", () => {
        const events = emptyEvents();
        events.typingEvents = [range(EventType.TYPING, 1_000, 4_800)];
        // Lead-in would reach back to 4500, inside the typing area.
        events.mouseClicks = [point(EventType.CLICK, 5_000)];

        const areas = getAllFocusAreas(events, SOURCE_SIZE, DURATION);

        expect(areas.map(a => a.reason)).toEqual([EventType.TYPING, EventType.CLICK]);
        expect(areas[1].sourceStartTimeMs).toBe(4_801);
        expectSortedNonOverlapping(areas);
    });
});

// ============================================================================
// Fuzz
// ============================================================================

describe('getAllFocusAreas — fuzz', () => {
    const DURATION = 60_000;

    /** Deterministic PRNG so any failure reproduces from its seed. */
    function makeRng(seed: number) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 0x100000000;
        };
    }

    function randomEvents(seed: number): UserEvents {
        const rnd = makeRng(seed);
        // Deliberately overruns DURATION so out-of-range events are exercised.
        const at = () => Math.floor(rnd() * DURATION * 1.1);
        const pos = () => ({ x: rnd() * SOURCE_SIZE.width, y: rnd() * SOURCE_SIZE.height });
        const rect = () => ({ x: rnd() * 1000, y: rnd() * 500, width: 40 + rnd() * 300, height: 30 + rnd() * 200 });

        const pointAt = (type: BaseEvent['type']): BaseEvent =>
            ({ type, timestamp: at(), mousePos: pos(), targetRect: rect() });
        const rangeAt = (type: BaseEvent['type']): BaseEvent => {
            const t = at();
            return { type, timestamp: t, endTime: t + Math.floor(rnd() * 4000), mousePos: pos(), targetRect: rect() };
        };

        // Dense mouse positions, loosely clustered, so hovers actually fire.
        const mousePositions: BaseEvent[] = [];
        let anchor = pos();
        for (let t = 0; t < DURATION; t += 50) {
            if (rnd() < 0.02) anchor = pos();
            mousePositions.push({
                type: EventType.MOUSEPOS,
                timestamp: t,
                mousePos: { x: anchor.x + (rnd() - 0.5) * 120, y: anchor.y + (rnd() - 0.5) * 120 },
            });
        }

        const many = (k: number) => Array.from({ length: k });
        const events = emptyEvents();
        events.mousePositions = mousePositions;
        events.mouseClicks = many(25).map(() => pointAt(EventType.CLICK));
        events.scrolls = many(12).map(() => rangeAt(EventType.SCROLL));
        events.typingEvents = many(10).map(() => rangeAt(EventType.TYPING));
        events.urlChanges = many(4).map(() => ({ ...pointAt(EventType.URLCHANGE), url: 'https://example.test' })) as UserEvents['urlChanges'];
        events.hoveredCards = many(6).map(() => ({
            ...rangeAt(EventType.HOVERED_CARD),
            cornerRadius: [0, 0, 0, 0],
        })) as UserEvents['hoveredCards'];
        return events;
    }

    it('holds the contract across 200 randomized event streams', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const areas = getAllFocusAreas(randomEvents(seed), SOURCE_SIZE, DURATION);
            expect(areas.length).toBeGreaterThan(0);
            expectSortedNonOverlapping(areas, `seed ${seed} `);

            for (const area of areas) {
                expect(area.sourceStartTimeMs).toBeGreaterThanOrEqual(0);
                expect(area.sourceEndTimeMs).toBeLessThanOrEqual(DURATION);
            }
        }
    });
});
