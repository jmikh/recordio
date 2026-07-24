/**
 * POST /project-update — Part 2 Batch 2. The load-bearing route of the
 * batch: cloudVersion null IS the version-conflict signal
 * (CloudVersionConflictError client-side), and the SQL fn's three paths
 * are pinned — incl. the hash short-circuit that BYPASSES the version
 * check when project_data is unchanged.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
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
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-update',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

// No expectedVersion key = no version check (null would be Ajv-coerced to 0)
const validBody = (projectId: string, over: Record<string, unknown> = {}) => ({
    projectId,
    projectData: { a: 1 },
    durationMs: 5000,
    ...over,
});

describe('POST /project-update (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, validBody('p-1'));
        expect(res.statusCode).toBe(401);
    });

    it.each([
        ['missing projectId', { projectData: {} }],
        ['missing projectData', { projectId: 'p-1' }],
        ['non-integer expectedVersion', { projectId: 'p-1', projectData: {}, expectedVersion: 'x' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const { app } = validationApp();
        const res = await post(app, body, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-update (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
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

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const p = await seedProject(pool, opts);
        createdProjects.push(p.id);
        return p;
    }

    async function row(id: string) {
        const { rows } = await pool.query(
            'SELECT project_data, cloud_version, duration_ms FROM projects WHERE id = $1', [id]);
        return rows[0] as { project_data: unknown; cloud_version: number; duration_ms: number | null };
    }

    it('no expectedVersion: updates data WITHOUT bumping the version (SQL parity)', async () => {
        const p = await seed({ projectData: { a: 1 }, cloudVersion: 3 });
        const { app } = testApp();

        const res = await post(app, validBody(p.id, { projectData: { a: 2 } }),
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ cloudVersion: 3 });
        expect(await row(p.id)).toMatchObject({
            project_data: { a: 2 }, cloud_version: 3, duration_ms: 5000 });
    });

    it('matching expectedVersion: compare-and-set bumps to expected+1', async () => {
        const p = await seed({ projectData: { a: 1 }, cloudVersion: 3 });
        const { app } = testApp();

        const res = await post(app,
            validBody(p.id, { projectData: { a: 2 }, expectedVersion: 3 }),
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.json()).toEqual({ cloudVersion: 4 });
        expect(await row(p.id)).toMatchObject({ project_data: { a: 2 }, cloud_version: 4 });
    });

    it('CONFLICT: stale expectedVersion + changed data → cloudVersion null, row untouched', async () => {
        const p = await seed({ projectData: { a: 1 }, cloudVersion: 3 });
        const { app } = testApp();

        const res = await post(app,
            validBody(p.id, { projectData: { a: 2 }, expectedVersion: 2 }),
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ cloudVersion: null });
        expect(await row(p.id)).toMatchObject({ project_data: { a: 1 }, cloud_version: 3 });
    });

    it('HASH SHORT-CIRCUIT: unchanged data bypasses the version check even when stale', async () => {
        const p = await seed({ projectData: { a: 1 }, cloudVersion: 3 });
        const { app } = testApp();

        const res = await post(app,
            validBody(p.id, { projectData: { a: 1 }, expectedVersion: 1, durationMs: 9000 }),
            await userToken({ sub: SEEDED_USER_ID }));

        // Not a conflict: current version returned, duration updated
        expect(res.json()).toEqual({ cloudVersion: 3 });
        expect(await row(p.id)).toMatchObject({
            project_data: { a: 1 }, cloud_version: 3, duration_ms: 9000 });
    });

    it('AJV-COERCION pin: an explicit null expectedVersion fails SAFE (coerced to 0 → conflict, row untouched)', async () => {
        // Clients must OMIT the key; this pins that sending null can never
        // write anything (versions start at 1, so a 0-check always misses)
        const p = await seed({ projectData: { a: 1 }, cloudVersion: 3 });
        const { app } = testApp();

        const res = await post(app,
            validBody(p.id, { projectData: { a: 2 }, expectedVersion: null }),
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ cloudVersion: null });
        expect(await row(p.id)).toMatchObject({ project_data: { a: 1 }, cloud_version: 3 });
    });

    it('403 for a non-editor, row untouched', async () => {
        const p = await seed({ projectData: { a: 1 } });
        const { app } = testApp();

        const res = await post(app, validBody(p.id, { projectData: { a: 2 } }),
            await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not an editor of this project' });
        expect(await row(p.id)).toMatchObject({ project_data: { a: 1 } });
    });

    it('403 for a soft-deleted project', async () => {
        const p = await seed({ deletedAt: new Date().toISOString() });
        const { app } = testApp();
        const res = await post(app, validBody(p.id),
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
    });
});
