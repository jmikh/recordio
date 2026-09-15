/**
 * Job `screenshots.purge-deleted` — e2e against the real local Postgres,
 * fakeS3 for storage (plans/screenshots Step 2).
 *
 * LOCAL-DATA SAFETY: same guard as projectsPurgeDeleted.test — the fake
 * clock is pinned to 2000-01-01, so only this suite's 1999-dated seeds
 * can ever match the cutoff. Do not move the clock forward.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { screenshotsPurgeDeleted } from '../../src/jobs/screenshotsPurgeDeleted.js';
import { jobs } from '../../src/jobs/index.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import {
    createTestPool,
    deleteScreenshots,
    hasTestDb,
    SEEDED_USER_ID,
    seedScreenshot,
} from '../helpers/db.js';

const CLOCK_START = new Date('2000-01-01T00:00:00.000Z');
const OLD_DELETED_AT = '1999-01-01T00:00:00.000Z';
const RECENT_DELETED_AT = '1999-12-15T00:00:00.000Z';

const warnings: object[] = [];
const log = { warn: (obj: object) => void warnings.push(obj) };

it('is registered as a daily job', () => {
    expect(jobs.find((j) => j.name === 'screenshots.purge-deleted')?.period).toBe('daily');
});

describe.runIf(hasTestDb())('jobs/screenshotsPurgeDeleted (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const created: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteScreenshots(pool, created);
        created.length = 0;
        warnings.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testDeps(): FakeDeps {
        const deps = createFakeDeps({ db: pool });
        deps.clock.set(CLOCK_START);
        return deps;
    }

    async function seed(deletedAt: string | null, permanentlyDeleted = false) {
        const s = await seedScreenshot(pool, { deletedAt, permanentlyDeleted });
        created.push(s.id);
        return s;
    }

    async function row(id: string) {
        const { rows } = await pool.query('SELECT id, permanently_deleted FROM screenshots WHERE id = $1', [id]);
        return rows[0] as { id: string; permanently_deleted: boolean } | undefined;
    }

    it('purges a >30d-deleted screenshot: whole storage prefix deleted, row gone; recent and live rows untouched', async () => {
        const deps = testDeps();
        const old = await seed(OLD_DELETED_AT);
        const recent = await seed(RECENT_DELETED_AT);
        const live = await seed(null);
        const prefix = `${SEEDED_USER_ID}/screenshots/${old.id}/`;
        for (const key of [`${prefix}source.png`, `${prefix}thumbnail.webp`, `${prefix}renders/v3.png`]) {
            deps.s3.objects.set(key, { body: new Uint8Array(1), contentType: 'image/png' });
        }
        const unrelated = `${SEEDED_USER_ID}/screenshots/${live.id}/source.png`;
        deps.s3.objects.set(unrelated, { body: new Uint8Array(1), contentType: 'image/png' });

        const result = await screenshotsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
        expect(await row(old.id)).toBeUndefined();
        expect(deps.s3.deletedKeys.sort()).toEqual([
            `${prefix}renders/v3.png`, `${prefix}source.png`, `${prefix}thumbnail.webp`,
        ]);
        expect(deps.s3.objects.has(unrelated)).toBe(true);
        expect(await row(recent.id)).toMatchObject({ permanently_deleted: false });
        expect(await row(live.id)).toMatchObject({ permanently_deleted: false });
        expect(warnings).toEqual([]);
    });

    it('a storage failure leaves the row MARKED permanently_deleted for the next run', async () => {
        const deps = testDeps();
        const old = await seed(OLD_DELETED_AT);
        deps.s3.listObjects = async () => { throw new Error('s3 down'); };

        const result = await screenshotsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
        expect(await row(old.id)).toMatchObject({ permanently_deleted: true });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ 'screenshot.id': old.id });
    });

    it('resumes an already-marked row without re-marking', async () => {
        const deps = testDeps();
        const old = await seed(OLD_DELETED_AT, true);
        const result = await screenshotsPurgeDeleted(deps, log);
        expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
        expect(await row(old.id)).toBeUndefined();
    });
});
