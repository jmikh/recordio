/**
 * Scheduler — no DB, no HTTP: fakeClock drives periods, stub jobs count
 * runs, a capture logger asserts the canonical job events. Ticks are
 * driven manually via the handle (the real setInterval is hourly and
 * unref'd — it never fires within a test).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startScheduler, type SchedulerHandle } from '../src/scheduler.js';
import type { JobDefinition } from '../src/jobs/index.js';
import type { JobRunResult } from '../src/jobs/types.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface CapturedLine extends Record<string, unknown> {
    msg?: string;
}

function captureLog() {
    const lines: CapturedLine[] = [];
    const push = (obj: object, msg?: string) => void lines.push({ ...obj, msg });
    return { lines, log: { info: push, warn: push, error: push } };
}

function stubJob(
    name: string,
    period: JobDefinition['period'],
    result: JobRunResult = { itemsProcessed: 2, itemsFailed: 1, batchFull: false },
): JobDefinition & { runs: number } {
    const def = {
        name,
        period,
        runs: 0,
        async run() {
            def.runs++;
            return result;
        },
    };
    return def;
}

describe('scheduler', () => {
    let handle: SchedulerHandle | undefined;

    afterEach(() => {
        handle?.stop();
        handle = undefined;
    });

    function start(deps: FakeDeps, jobs: JobDefinition[], onJobError?: (err: unknown) => void) {
        const { lines, log } = captureLog();
        handle = startScheduler(deps, jobs, { log, onJobError });
        return { handle, lines };
    }

    it('startup tick runs every job once and emits job.run with status=success, trigger=startup and normalized counts', async () => {
        const deps = createFakeDeps();
        const daily = stubJob('test.daily', 'daily');
        const hourly = stubJob('test.hourly', 'hourly', {
            itemsProcessed: 50,
            itemsFailed: 0,
            batchFull: true,
        });
        const { handle: s, lines } = start(deps, [daily, hourly]);

        await s.startup;

        expect(daily.runs).toBe(1);
        expect(hourly.runs).toBe(1);
        const events = lines.filter((l) => l.event === 'job.run');
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            'job.name': 'test.daily',
            'job.trigger': 'startup',
            'job.status': 'success',
            'job.items_processed': 2,
            'job.items_failed': 1,
            'job.batch_full': false,
        });
        expect(typeof events[0].duration_ms).toBe('number');
        expect(events[1]).toMatchObject({
            'job.name': 'test.hourly',
            'job.trigger': 'startup',
            'job.batch_full': true,
        });
    });

    it('a second tick in the same period runs nothing', async () => {
        const deps = createFakeDeps();
        const daily = stubJob('test.daily', 'daily');
        const hourly = stubJob('test.hourly', 'hourly');
        const { handle: s } = start(deps, [daily, hourly]);
        await s.startup;

        await s.tick();

        expect(daily.runs).toBe(1);
        expect(hourly.runs).toBe(1);
    });

    it('crossing an hour boundary re-runs hourly jobs but not daily; crossing a day re-runs both', async () => {
        const deps = createFakeDeps(); // fake clock starts at 2026-01-01T00:00Z
        const daily = stubJob('test.daily', 'daily');
        const hourly = stubJob('test.hourly', 'hourly');
        const { handle: s, lines } = start(deps, [daily, hourly]);
        await s.startup;

        deps.clock.advance(HOUR);
        await s.tick();
        expect(hourly.runs).toBe(2);
        expect(daily.runs).toBe(1);

        deps.clock.advance(DAY);
        await s.tick();
        expect(hourly.runs).toBe(3);
        expect(daily.runs).toBe(2);

        // Interval-triggered events are marked as such
        const triggers = lines
            .filter((l) => l.event === 'job.run')
            .map((l) => l['job.trigger']);
        expect(triggers).toEqual(['startup', 'startup', 'interval', 'interval', 'interval']);
    });

    it('notBeforeUtcHour: earlier ticks skip without claiming; runs on the first tick at/after the hour, once per day', async () => {
        const deps = createFakeDeps(); // fake clock starts at 2026-01-01T00:00Z
        const gated = stubJob('test.gated', 'daily');
        gated.notBeforeUtcHour = 13;
        const { handle: s } = start(deps, [gated]);

        await s.startup;
        expect(gated.runs).toBe(0); // 00:00 — skipped, day not claimed

        deps.clock.advance(12 * HOUR);
        await s.tick();
        expect(gated.runs).toBe(0); // 12:00 — still before the gate

        deps.clock.advance(HOUR);
        await s.tick();
        expect(gated.runs).toBe(1); // 13:00 — runs

        deps.clock.advance(HOUR);
        await s.tick();
        expect(gated.runs).toBe(1); // 14:00 — same day, already claimed

        deps.clock.advance(DAY);
        await s.tick();
        expect(gated.runs).toBe(2); // next day, past the gate
    });

    it('a fresh scheduler instance re-runs the current period (accepted deploy behavior, by design)', async () => {
        const deps = createFakeDeps();
        const daily = stubJob('test.daily', 'daily');
        const first = start(deps, [daily]);
        await first.handle.startup;
        first.handle.stop();

        const second = start(deps, [daily]);
        await second.handle.startup;

        expect(daily.runs).toBe(2);
    });

    it('a throwing job: tick survives, later jobs still run, job.run with status=failure emitted, onJobError called', async () => {
        const deps = createFakeDeps();
        const boom = new Error('job exploded');
        const bad: JobDefinition = {
            name: 'test.bad',
            period: 'hourly',
            run: async () => {
                throw boom;
            },
        };
        const good = stubJob('test.good', 'hourly');
        const errors: unknown[] = [];
        const { handle: s, lines } = start(deps, [bad, good], (err) => void errors.push(err));

        await s.startup;

        expect(good.runs).toBe(1);
        expect(errors).toEqual([boom]);
        expect(lines.find((l) => l['job.status'] === 'failure')).toMatchObject({
            event: 'job.run',
            'job.name': 'test.bad',
            'job.trigger': 'startup',
        });
        // The success event for the healthy job still emitted
        expect(
            lines.filter((l) => l['job.status'] === 'success').map((l) => l['job.name']),
        ).toEqual(['test.good']);
    });

    it('a failed job does not retry within the same period (claimed before running)', async () => {
        const deps = createFakeDeps();
        let attempts = 0;
        const flaky: JobDefinition = {
            name: 'test.flaky',
            period: 'hourly',
            run: async () => {
                attempts++;
                throw new Error('still down');
            },
        };
        const { handle: s } = start(deps, [flaky]);
        await s.startup;
        await s.tick();
        expect(attempts).toBe(1);

        deps.clock.advance(HOUR);
        await s.tick();
        expect(attempts).toBe(2);
    });

    it('stop() is idempotent and prevents nothing from the manual tick path', async () => {
        const deps = createFakeDeps();
        const hourly = stubJob('test.hourly', 'hourly');
        const { handle: s } = start(deps, [hourly]);
        await s.startup;

        s.stop();
        s.stop();

        // Manual ticks still work after stop (only the interval is cleared)
        deps.clock.advance(HOUR);
        await s.tick();
        expect(hourly.runs).toBe(2);
    });
});
