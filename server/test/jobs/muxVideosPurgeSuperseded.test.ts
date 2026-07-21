/**
 * Job `mux_videos.purge-superseded` — e2e against the real local
 * Postgres (inline candidates SQL since the soft-delete removal
 * 2026-07-22; the `mux_video_purge_candidates()` DB function is gone).
 *
 * Every run passes `onlyIds` (the job's TEST-ONLY scoping seam): the
 * candidates query is global and this pool is the shared long-lived
 * local dev DB — an unscoped run would delete real local rows while
 * the Mux/S3 deletions hit fakes, creating the exact dangling-asset
 * leak the job exists to prevent. Assertions are own-rows-only.
 *
 * Note: the completed-v1 candidate coexists with completed-v3 as a
 * plain second completed row — legal since the one-active-completed
 * unique index was dropped; superseded completed rows just wait for
 * this daily sweep.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { muxVideosPurgeSuperseded } from '../../src/jobs/muxVideosPurgeSuperseded.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    seedMuxVideo,
    seedProject,
} from '../helpers/db.js';

const warnings: object[] = [];
const log = { warn: (obj: object) => void warnings.push(obj) };

describe.runIf(hasTestDb())('jobs/muxVideosPurgeSuperseded (e2e, real Postgres)', () => {
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
        return createFakeDeps({ db: pool });
    }

    async function seed() {
        const project = await seedProject(pool, {});
        createdProjects.push(project.id);
        return project;
    }

    async function muxIds(projectId: string): Promise<string[]> {
        const { rows } = await pool.query(
            'SELECT id FROM mux_videos WHERE project_id = $1',
            [projectId],
        );
        return (rows as { id: string }[]).map((r) => r.id);
    }

    it('purges superseded rows (asset + file + row), keeps the highest completed version', async () => {
        const deps = testDeps();
        const project = await seed();
        const v1 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            muxAssetId: 'asset-v1',
            renderStoragePath: 'u/p/renders/v1.mp4',
        });
        const v2 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'failed',
            muxAssetId: null,
            renderStoragePath: null,
        });
        const v3 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 3,
            status: 'completed',
            muxAssetId: 'asset-v3',
            renderStoragePath: 'u/p/renders/v3.mp4',
        });

        const result = await muxVideosPurgeSuperseded(deps, log, { onlyIds: [v1, v2, v3] });

        expect(result).toEqual({ purged: 2, total: 2 });
        expect(deps.mux.deletedAssetIds).toEqual(['asset-v1']);
        expect(deps.s3.deletedKeys).toEqual(['u/p/renders/v1.mp4']);
        // v2 had NULL asset + NULL path — both steps skipped, row still deleted
        expect(await muxIds(project.id)).toEqual([v3]);
    });

    it('never purges pending rows', async () => {
        const deps = testDeps();
        const project = await seed();
        const pending = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });
        const v2 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'completed',
            muxAssetId: 'asset-v2',
        });

        const result = await muxVideosPurgeSuperseded(deps, log, { onlyIds: [pending, v2] });

        expect(result).toEqual({ purged: 0, total: 0 });
        expect((await muxIds(project.id)).sort()).toEqual([pending, v2].sort());
        expect(deps.mux.deletedAssetIds).toEqual([]);
    });

    it('deleteAsset failure: row kept for the next run, batch continues', async () => {
        const deps = testDeps();
        deps.mux.deleteAsset = async (assetId) => {
            if (assetId === 'asset-bad') throw new Error('mux down');
            deps.mux.deletedAssetIds.push(assetId);
        };
        const project = await seed();
        const bad = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'failed',
            muxAssetId: 'asset-bad',
        });
        const good = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'canceled',
            muxAssetId: 'asset-good',
        });
        const v3 = await seedMuxVideo(pool, {
            projectId: project.id,
            cloudVersion: 3,
            status: 'completed',
        });

        const result = await muxVideosPurgeSuperseded(deps, log, { onlyIds: [bad, good, v3] });

        expect(result).toEqual({ purged: 1, total: 2 });
        expect(deps.mux.deletedAssetIds).toEqual(['asset-good']);
        // The failed row survives, still holding its asset reference
        expect((await muxIds(project.id)).sort()).toEqual([bad, v3].sort());
        expect(warnings).toHaveLength(1);
    });
});
