/**
 * POST /project-rename + /project-update-name — Part 2 Batch 2. The two
 * SQL fns were exact duplicates (suggested_changes), so one parameterized
 * suite covers both routes.
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
    seedProjectEditor,
} from './helpers/db.js';

const ROUTES = ['/project-rename', '/project-update-name'] as const;

async function post(app: App, url: string, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe.each(ROUTES)('POST %s (auth + validation, no db)', (url) => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, url, { projectId: 'p-1', name: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it.each([
        ['missing name', { projectId: 'p-1' }],
        ['missing projectId', { name: 'x' }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const { app } = validationApp();
        const res = await post(app, url, body, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb()).each(ROUTES)('POST %s (e2e, real Postgres)', (url) => {
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

    async function nameOf(id: string) {
        const { rows } = await pool.query('SELECT name FROM projects WHERE id = $1', [id]);
        return (rows[0] as { name: string }).name;
    }

    it('the owner renames a live project', async () => {
        const p = await seed({ name: 'Old' });
        const { app } = testApp();
        const res = await post(app, url, { projectId: p.id, name: 'New' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await nameOf(p.id)).toBe('New');
    });

    it('an explicit editor renames too', async () => {
        const p = await seed({ name: 'Old' });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID });
        const { app } = testApp();
        const res = await post(app, url, { projectId: p.id, name: 'ByEditor' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
        expect(await nameOf(p.id)).toBe('ByEditor');
    });

    it('403 for a non-editor, name untouched', async () => {
        const p = await seed({ name: 'Old' });
        const { app } = testApp();
        const res = await post(app, url, { projectId: p.id, name: 'Nope' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Not an editor of this project' });
        expect(await nameOf(p.id)).toBe('Old');
    });

    it('403 for a soft-deleted project', async () => {
        const p = await seed({ deletedAt: new Date().toISOString() });
        const { app } = testApp();
        const res = await post(app, url, { projectId: p.id, name: 'x' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
    });
});
