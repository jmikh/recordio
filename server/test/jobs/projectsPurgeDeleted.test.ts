/**
 * Job `projects.purge-deleted` — e2e against the real local Postgres,
 * fakes for S3/Mux; the job function is called directly (no scheduler).
 *
 * LOCAL-DATA SAFETY: the job matches globally (`deleted_at < now-30d`)
 * and this pool points at the shared, long-lived local dev DB. The
 * fake clock is pinned to 2000-01-01, so the cutoff (1999-12-02)
 * predates the product — no real row can ever match; only this
 * suite's 1999-dated seeds do. Do not move the clock forward.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { projectsPurgeDeleted } from '../../src/jobs/projectsPurgeDeleted.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    SEEDED_USER_ID,
    seedMuxVideo,
    seedProject,
} from '../helpers/db.js';

const CLOCK_START = new Date('2000-01-01T00:00:00.000Z');
/** Older than the 30-day cutoff relative to CLOCK_START */
const OLD_DELETED_AT = '1999-01-01T00:00:00.000Z';
/** Soft-deleted, but within the 30-day window */
const RECENT_DELETED_AT = '1999-12-15T00:00:00.000Z';

const warnings: object[] = [];
const log = { warn: (obj: object) => void warnings.push(obj) };

describe.runIf(hasTestDb())('jobs/projectsPurgeDeleted (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
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

    async function seed(deletedAt: string | null) {
        const project = await seedProject(pool, { deletedAt });
        createdProjects.push(project.id);
        return project;
    }

    async function projectRow(id: string) {
        const { rows } = await pool.query(
            'SELECT id, permanently_deleted FROM projects WHERE id = $1',
            [id],
        );
        return rows[0] as { id: string; permanently_deleted: boolean } | undefined;
    }

    it('purges a >30d-deleted project: marked, mux rows + assets purged, whole storage prefix deleted, row gone', async () => {
        const deps = testDeps();
        const project = await seed(OLD_DELETED_AT);
        // One row with a Mux asset, one still pending (no asset) — a
        // 30-day-deleted project has no legitimate in-flight work
        await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            muxAssetId: 'asset-to-delete',
        });
        await seedMuxVideo(pool, { projectId: project.id, cloudVersion: 2, status: 'pending' });
        // Top-level file AND a renders/ subkey — pins the recursive-list
        // fix (the Deno .list() missed subfolders and orphaned them)
        const prefix = `${SEEDED_USER_ID}/${project.id}`;
        deps.s3.objects.set(`${prefix}/screen.webm`, { body: new Uint8Array(1), contentType: 'video/webm' });
        deps.s3.objects.set(`${prefix}/renders/v1.mp4`, { body: new Uint8Array(1), contentType: 'video/mp4' });
        deps.s3.objects.set('unrelated/other.webm', { body: new Uint8Array(1), contentType: 'video/webm' });

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
        // Mux asset deleted BEFORE the row went (the cascade-leak fix)
        expect(deps.mux.deletedAssetIds).toEqual(['asset-to-delete']);
        expect(deps.s3.deletedKeys.sort()).toEqual([
            `${prefix}/renders/v1.mp4`,
            `${prefix}/screen.webm`,
        ]);
        expect(deps.s3.objects.has('unrelated/other.webm')).toBe(true);
        expect(await projectRow(project.id)).toBeUndefined();
        const { rows: muxRows } = await pool.query(
            'SELECT id FROM mux_videos WHERE project_id = $1',
            [project.id],
        );
        expect(muxRows).toHaveLength(0);
    });

    it('skips recently-deleted and non-deleted projects', async () => {
        const deps = testDeps();
        const recent = await seed(RECENT_DELETED_AT);
        const alive = await seed(null);

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0 });
        expect((await projectRow(recent.id))?.permanently_deleted).toBe(false);
        expect((await projectRow(alive.id))?.permanently_deleted).toBe(false);
    });

    it('resumes a previously-marked project (permanently_deleted already true)', async () => {
        const deps = testDeps();
        const project = await seed(OLD_DELETED_AT);
        await pool.query('UPDATE projects SET permanently_deleted = true WHERE id = $1', [project.id]);

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
        expect(await projectRow(project.id)).toBeUndefined();
    });

    it('mux deleteAsset failure: project row kept + marked (no cascade, no dangling asset), counted failed', async () => {
        const deps = testDeps();
        deps.mux.deleteAsset = async () => {
            throw new Error('mux down');
        };
        const project = await seed(OLD_DELETED_AT);
        const muxId = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            muxAssetId: 'asset-kept',
        });

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
        const row = await projectRow(project.id);
        expect(row).toMatchObject({ permanently_deleted: true });
        // The mux row (and its asset reference) survives for the retry
        const { rows: muxRows } = await pool.query(
            'SELECT id, mux_asset_id FROM mux_videos WHERE project_id = $1',
            [project.id],
        );
        expect(muxRows).toEqual([{ id: muxId, mux_asset_id: 'asset-kept' }]);
        expect(warnings).toHaveLength(1);
    });

    it('storage failure: row kept + marked, batch continues to the next project', async () => {
        const deps = testDeps();
        const failing = await seed(OLD_DELETED_AT);
        const healthy = await seed(OLD_DELETED_AT);
        deps.s3.objects.set(`${SEEDED_USER_ID}/${failing.id}/screen.webm`, {
            body: new Uint8Array(1),
            contentType: 'video/webm',
        });
        const realDelete = deps.s3.deleteObjects.bind(deps.s3);
        deps.s3.deleteObjects = async (keys) => {
            if (keys.some((k) => k.includes(failing.id))) throw new Error('s3 down');
            return realDelete(keys);
        };

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
        expect((await projectRow(failing.id))?.permanently_deleted).toBe(true);
        expect(await projectRow(healthy.id)).toBeUndefined();
    });

    it('respects the batch LIMIT of 20', async () => {
        const deps = testDeps();
        for (let i = 0; i < 21; i++) {
            await seed(OLD_DELETED_AT);
        }

        const result = await projectsPurgeDeleted(deps, log);

        expect(result).toEqual({ processed: 20, succeeded: 20, failed: 0 });
        const { rows } = await pool.query(
            'SELECT id FROM projects WHERE id = ANY($1::uuid[])',
            [createdProjects],
        );
        expect(rows).toHaveLength(1); // one left for the next run
    });
});
