import type { Clock } from '../../src/ports/clock.js';

export interface FakeClock extends Clock {
    advance(ms: number): void;
    set(date: Date): void;
}

export function createFakeClock(start = new Date('2026-01-01T00:00:00.000Z')): FakeClock {
    let current = start.getTime();
    return {
        now: () => new Date(current),
        advance: (ms) => { current += ms; },
        set: (date) => { current = date.getTime(); },
    };
}
