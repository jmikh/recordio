/**
 * Job `render_jobs.purge-superseded` — e2e against the real local
 * Postgres (plain SQL candidates query, no DB function — the job has
 * no edge-fn ancestor; it replaces the broken cron_render_purge).
 *
 * Every run passes `onlyIds` (TEST-ONLY scoping seam) — same
 * local-dev-DB safety reasoning as the mux suite; assertions are
 * own-rows-only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { renderJobsPurgeSuperseded } from '../../src/jobs/renderJobsPurgeSuperseded.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    seedProject,
    seedRenderJob,
} from '../helpers/db.js';

const warnings: object[] = [];
const log = { warn: (obj: object) => void warnings.push(obj) };

describe.runIf(hasTestDb())('jobs/renderJobsPurgeSuperseded (e2e, real Postgres)', () => {
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

    async function seed() {
        const project = await seedProject(pool, {});
        createdProjects.push(project.id);
        return project;
    }

    async function jobIds(projectId: string): Promise<string[]> {
        const { rows } = await pool.query(
            'SELECT id FROM render_jobs WHERE project_id = $1',
            [projectId],
        );
        return (rows as { id: string }[]).map((r) => r.id);
    }

    function seedFile(deps: FakeDeps, key: string) {
        deps.s3.objects.set(key, { body: new Uint8Array(1), contentType: 'video/mp4' });
    }

    it('purges superseded rows + files, keeps the latest completed render AND its file (mp4-download pin)', async () => {
        const deps = createFakeDeps({ db: pool });
        const project = await seed();
        const v1 = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'completed',
            renderStoragePath: 'u/p/renders/v1.mp4',
        });
        const v2 = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'failed',
            renderStoragePath: null, // NULL path — storage step skipped, row still deleted
        });
        const v3 = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 3,
            status: 'completed',
            renderStoragePath: 'u/p/renders/v3.mp4',
        });
        seedFile(deps, 'u/p/renders/v1.mp4');
        seedFile(deps, 'u/p/renders/v3.mp4');

        const result = await renderJobsPurgeSuperseded(deps, log, { onlyIds: [v1, v2, v3] });

        expect(result).toEqual({ purged: 2, total: 2 });
        expect(deps.s3.deletedKeys).toEqual(['u/p/renders/v1.mp4']);
        // The latest completed render row and its downloadable file survive
        expect(await jobIds(project.id)).toEqual([v3]);
        expect(deps.s3.objects.has('u/p/renders/v3.mp4')).toBe(true);
    });

    it('never purges pending rows', async () => {
        const deps = createFakeDeps({ db: pool });
        const project = await seed();
        const pending = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'pending',
        });
        const v2 = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'completed',
        });

        const result = await renderJobsPurgeSuperseded(deps, log, { onlyIds: [pending, v2] });

        expect(result).toEqual({ purged: 0, total: 0 });
        expect((await jobIds(project.id)).sort()).toEqual([pending, v2].sort());
    });

    it('storage failure: row kept for the next run, batch continues', async () => {
        const deps = createFakeDeps({ db: pool });
        const realDelete = deps.s3.deleteObjects.bind(deps.s3);
        deps.s3.deleteObjects = async (keys) => {
            if (keys.includes('u/p/renders/bad.mp4')) throw new Error('s3 down');
            return realDelete(keys);
        };
        const project = await seed();
        const bad = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 1,
            status: 'failed',
            renderStoragePath: 'u/p/renders/bad.mp4',
        });
        const good = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 2,
            status: 'canceled',
            renderStoragePath: 'u/p/renders/good.mp4',
        });
        const v3 = await seedRenderJob(pool, {
            projectId: project.id,
            cloudVersion: 3,
            status: 'completed',
        });

        const result = await renderJobsPurgeSuperseded(deps, log, { onlyIds: [bad, good, v3] });

        expect(result).toEqual({ purged: 1, total: 2 });
        expect((await jobIds(project.id)).sort()).toEqual([bad, v3].sort());
        expect(warnings).toHaveLength(1);
    });
});
