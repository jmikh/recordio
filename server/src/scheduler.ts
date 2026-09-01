/**
 * Minimal in-process job scheduler (Wave C — plan "Scheduler design").
 *
 * One tick on start + setInterval hourly. Each tick, for each job:
 * compute the current period from the injected clock (daily → UTC date,
 * hourly → UTC hour) and run unless the IN-MEMORY last-run-period map
 * says it already ran this period. Deliberately NO ledger table and no
 * DB claim (user decision 2026-07-17): every job is delete-by-condition
 * and re-run/double-run safe, so a deploy resetting the map (the
 * startup tick re-runs everything) or a brief two-instance overlap is
 * harmless — `job.trigger` makes those runs identifiable in logs.
 *
 * Logging is the metrics/audit surface: one `job.run` event per run,
 * discriminated by `job.status` (see LogEventCatalog). Known accepted
 * limitation: a dead scheduler emits nothing — liveness is "do I see
 * job.run lines in Railway logs".
 *
 * Timing divergences from the decommissioned pg_cron entries
 * (documented in the plan): the daily job ran at 03:00 UTC → now the
 * first tick after UTC midnight (or after a deploy); hourly jobs ran
 * at :15/:25 → now on the process's tick cadence, anchored at startup.
 * Harmless for 30-day/superseded-version purges.
 *
 * Wired in server.ts (never app.ts — buildApp stays a pure factory).
 * A tick never throws: each job is individually caught, logged, and
 * reported via onJobError (Sentry in production).
 */
import type { Deps } from './deps.js';
import type { JobDefinition } from './jobs/index.js';
import { logEvent } from './logging.js';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

export interface SchedulerLogger {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
}

export interface SchedulerOptions {
    log: SchedulerLogger;
    onJobError?: (err: unknown) => void;
}

export interface SchedulerHandle {
    /** Resolves when the startup tick has finished (tests await it). */
    startup: Promise<void>;
    /** Run one interval tick manually (tests drive periods via the fake clock). */
    tick(): Promise<void>;
    stop(): void;
}

function periodKey(period: JobDefinition['period'], now: Date): string {
    // ISO slices: daily → '2026-07-18', hourly → '2026-07-18T14'
    return period === 'daily' ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 13);
}

export function startScheduler(
    deps: Deps,
    jobs: JobDefinition[],
    opts: SchedulerOptions,
): SchedulerHandle {
    const { log, onJobError } = opts;
    const lastRunPeriod = new Map<string, string>();

    async function tick(trigger: 'startup' | 'interval'): Promise<void> {
        for (const job of jobs) {
            const period = periodKey(job.period, deps.clock.now());
            if (lastRunPeriod.get(job.name) === period) continue;
            // Claimed before running: a throwing job waits for the next
            // period instead of retrying every tick (matches the old
            // cron cadence; the work is idempotent catch-up anyway)
            lastRunPeriod.set(job.name, period);

            const startedAt = performance.now();
            try {
                const result = await job.run(deps, log);
                logEvent(log, 'job.run', {
                    'job.name': job.name,
                    'job.trigger': trigger,
                    'job.status': 'success',
                    duration_ms: Math.round(performance.now() - startedAt),
                    'job.items_processed': result.itemsProcessed,
                    'job.items_failed': result.itemsFailed,
                    'job.batch_full': result.batchFull,
                });
            } catch (err) {
                log.error({ err, 'job.name': job.name }, 'scheduled job threw');
                logEvent(log, 'job.run', {
                    'job.name': job.name,
                    'job.trigger': trigger,
                    'job.status': 'failure',
                    duration_ms: Math.round(performance.now() - startedAt),
                });
                onJobError?.(err);
            }
        }
    }

    const startup = tick('startup');
    const timer = setInterval(() => void tick('interval'), TICK_INTERVAL_MS);
    timer.unref();

    return {
        startup,
        tick: () => tick('interval'),
        stop: () => clearInterval(timer),
    };
}
