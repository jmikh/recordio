/**
 * Job `projects.expire-stale-pending` — e2e against the real local
 * Postgres; the job function is called directly (no scheduler).
 *
 * LOCAL-DATA SAFETY: same guard as projectsPurgeDeleted.test — the fake
 * clock is pinned to 2000-01-01, so only this suite's 1999-dated seeds
 * can ever match the cutoff (1999-12-02). Do not move the clock forward.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { projectsExpireStalePending } from '../../src/jobs/projectsExpireStalePending.js';
import { jobs } from '../../src/jobs/index.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { createTestPool, deleteProjects, hasTestDb, seedProject } from '../helpers/db.js';

const CLOCK_START = new Date('2000-01-01T00:00:00.000Z');
/** Older than the 30-day cutoff relative to CLOCK_START */
const OLD_CREATED_AT = '1999-01-01T00:00:00.000Z';
/** Created within the 30-day window */
const RECENT_CREATED_AT = '1999-12-15T00:00:00.000Z';

it('is registered as a daily job', () => {
    expect(jobs.find((j) => j.name === 'projects.expire-stale-pending')?.period).toBe('daily');
});

describe.runIf(hasTestDb())('jobs/projectsExpireStalePending (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const created: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteProjects(pool, created);
        created.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testDeps(): FakeDeps {
        const deps = createFakeDeps({ db: pool });
        deps.clock.set(CLOCK_START);
        return deps;
    }

    async function seed(opts: { createdAt: string; uploadStatus: 'pending' | 'ready'; deletedAt?: string }) {
        const p = await seedProject(pool, opts);
        created.push(p.id);
        return p;
    }

    async function row(id: string) {
        const { rows } = await pool.query(
            'SELECT deleted_at, upload_status FROM projects WHERE id = $1', [id]);
        return rows[0] as { deleted_at: Date | null; upload_status: string };
    }

    it('trashes a >30d-old pending project; recent pending, old ready and already-trashed rows untouched', async () => {
        const deps = testDeps();
        const stale = await seed({ createdAt: OLD_CREATED_AT, uploadStatus: 'pending' });
        const recent = await seed({ createdAt: RECENT_CREATED_AT, uploadStatus: 'pending' });
        const oldReady = await seed({ createdAt: OLD_CREATED_AT, uploadStatus: 'ready' });
        const alreadyTrashed = await seed({
            createdAt: OLD_CREATED_AT, uploadStatus: 'pending', deletedAt: '1999-06-01T00:00:00.000Z' });

        const result = await projectsExpireStalePending(deps);

        expect(result).toEqual({ processed: 1 });
        expect(await row(stale.id)).toMatchObject({ deleted_at: CLOCK_START, upload_status: 'pending' });
        expect((await row(recent.id)).deleted_at).toBeNull();
        expect((await row(oldReady.id)).deleted_at).toBeNull();
        expect((await row(alreadyTrashed.id)).deleted_at).toEqual(new Date('1999-06-01T00:00:00.000Z'));
    });

    it('re-run in the same period is a no-op', async () => {
        const deps = testDeps();
        await seed({ createdAt: OLD_CREATED_AT, uploadStatus: 'pending' });

        expect(await projectsExpireStalePending(deps)).toEqual({ processed: 1 });
        expect(await projectsExpireStalePending(deps)).toEqual({ processed: 0 });
    });
});
