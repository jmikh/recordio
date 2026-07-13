/**
 * Dependency ports for the app factory.
 *
 * Route handlers never import an SDK directly — every external dependency
 * enters through `buildApp(deps)` behind one of these interfaces, so tests
 * can drive the full HTTP stack with in-memory fakes (see server/test/fakes/).
 *
 * Step 0.5 of the migration plan expands this file with ports for Stripe,
 * Mux, S3, email, render worker, and transcription.
 */

/** Injectable clock — makes expiry/stale-job logic deterministic in tests. */
export interface Clock {
    now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Minimal query surface of pg.Pool. The real adapter is a pg Pool pointed
 * at Supavisor; end-to-end tests use a pool pointed at the local
 * `supabase start` Postgres — SQL is never faked.
 */
export interface Db {
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface Deps {
    db: Db;
    clock: Clock;
}
