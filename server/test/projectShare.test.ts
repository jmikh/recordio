/**
 * POST /project-share — Part 2 Batch 2. OWNER-only (stricter than the
 * editor routes — pinned); slug generated once, policy always applied.
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
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/project-share',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /project-share (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: invalid sharePolicy (replaces the SQL RAISE)', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1', sharePolicy: 'everyone' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-share (e2e, real Postgres)', () => {
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
            'SELECT slug, share_policy FROM projects WHERE id = $1', [id]);
        return rows[0] as { slug: string | null; share_policy: string | null };
    }

    it('first share creates a 12-char slug with isNew true and the default public policy', async () => {
        const p = await seed({ slug: null, sharePolicy: null });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        const body = res.json() as { slug: string; isNew: boolean };
        expect(body.isNew).toBe(true);
        expect(body.slug).toMatch(/^[0-9a-f]{12}$/);
        expect(await row(p.id)).toEqual({ slug: body.slug, share_policy: 'public' });
    });

    it('re-share keeps the slug (isNew false) and updates the policy', async () => {
        const p = await seed({ slug: null, sharePolicy: null });
        const { app } = testApp();
        const first = (await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_ID }))).json() as { slug: string };

        const res = await post(app, { projectId: p.id, sharePolicy: 'workspace' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.json()).toEqual({ slug: first.slug, isNew: false });
        expect(await row(p.id)).toEqual({ slug: first.slug, share_policy: 'workspace' });
    });

    it('403 with the exact body for an EDITOR (owner-only, stricter than editor routes)', async () => {
        const p = await seed({ slug: null });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Only the project owner can share a project' });
        expect((await row(p.id)).slug).toBeNull();
    });

    it.each([
        ['an unknown project', () => Promise.resolve(randomUUID())],
        ['a soft-deleted project', async () => {
            const p = await seedProject(pool, { deletedAt: new Date().toISOString() });
            return p.id;
        }],
    ])('404 with the exact body for %s', async (_name, idFn) => {
        const projectId = await idFn();
        createdProjects.push(projectId);
        const { app } = testApp();
        const res = await post(app, { projectId },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found' });
    });
});
