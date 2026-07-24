/**
 * POST /render-job-get-status — Part 2 Batch 2. Poller endpoint:
 * unknown job → { job: null } (tick skipped, no error noise);
 * editor access on the job's project.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedProjectEditor,
    seedRenderJob,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/render-job-get-status',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /render-job-get-status (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { jobId: 'j-1' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing jobId', async () => {
        const { app } = validationApp();
        const res = await post(app, {}, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /render-job-get-status (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        // render_jobs cascade with their project
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testApp() {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app };
    }

    it('returns the job fields the poller consumes (snake_case, parity)', async () => {
        const p = await seedProject(pool, {});
        createdProjects.push(p.id);
        const jobId = await seedRenderJob(pool, {
            projectId: p.id, cloudVersion: 1, status: 'completed',
            renderStoragePath: `${SEEDED_USER_ID}/${p.id}/renders/v1.mp4`,
        });

        const { app } = testApp();
        const res = await post(app, { jobId }, await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            job: {
                status: 'completed',
                progress: null,
                error: null,
                render_storage_path: `${SEEDED_USER_ID}/${p.id}/renders/v1.mp4`,
            },
        });
    });

    it('an explicit project editor can poll', async () => {
        const p = await seedProject(pool, {});
        createdProjects.push(p.id);
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID });
        const jobId = await seedRenderJob(pool, { projectId: p.id, cloudVersion: 1 });

        const { app } = testApp();
        const res = await post(app, { jobId }, await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
        expect((res.json() as { job: unknown }).job).not.toBeNull();
    });

    it('{ job: null } for an unknown job id (poller skips the tick)', async () => {
        const { app } = testApp();
        const res = await post(app, { jobId: randomUUID() },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ job: null });
    });

    it('403 for a non-editor of the job project', async () => {
        const p = await seedProject(pool, {});
        createdProjects.push(p.id);
        const jobId = await seedRenderJob(pool, { projectId: p.id, cloudVersion: 1 });

        const { app } = testApp();
        const res = await post(app, { jobId }, await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not an editor of this project' });
    });
});
