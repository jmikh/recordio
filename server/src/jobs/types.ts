/**
 * Shared job types (Wave C). A job is a plain function taking injected
 * deps — no scheduler involvement, tested exactly like services. The
 * scheduler consumes JobDefinition entries (see jobs/index.ts) whose
 * `run` normalizes each job's counts into a JobRunResult for the
 * canonical `job.run` log event.
 */

/** Structural sink for per-item failure warnings (req-less: jobs run outside requests). */
export interface JobLogger {
    warn(obj: object, msg?: string): void;
}

/** Normalized per-run counts — the scheduler folds these into `job.run`. */
export interface JobRunResult {
    itemsProcessed: number;
    itemsFailed: number;
    /** processed == the job's batch LIMIT → backlog is likely growing */
    batchFull: boolean;
}
