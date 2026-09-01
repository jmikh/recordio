/**
 * POST /project-delete + /project-restore + /project-confirm-upload —
 * Part 2 Batch 2. The three owner-gated boolean routes share their
 * shape (owner check IS the WHERE clause; false for non-owner /
 * not-found / wrong-state alike, no error), so one file covers them.
 *
 * /project-restore is additionally trial/Pro-gated since revamp Step 4
 * (canRestore) — its cases seed explicit workspaces; free-workspace
 * restore is 403 subscription_required.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedProject,
    seedSubscription,
    seedWorkspace,
} from './helpers/db.js';

async function post(app: App, url: string, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe.each([
    '/project-delete', '/project-restore', '/project-confirm-upload',
])('POST %s (auth + validation, no db)', (url) => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it('401 without a token', async () => {
        const { app } = validationApp();
        const res = await post(app, url, { projectId: 'p-1' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing projectId', async () => {
        const { app } = validationApp();
        const res = await post(app, url, {}, await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('project lifecycle routes (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteWorkspaces(pool, createdWorkspaces);
        createdProjects.length = 0;
        createdWorkspaces.length = 0;
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
            'SELECT deleted_at, upload_status FROM projects WHERE id = $1', [id]);
        return rows[0] as { deleted_at: string | null; upload_status: string };
    }

    describe('/project-delete', () => {
        it('owner soft-deletes a live project', async () => {
            const p = await seed();
            const { app } = testApp();
            const res = await post(app, '/project-delete', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ deleted: true });
            expect((await row(p.id)).deleted_at).not.toBeNull();
        });

        it('false for a non-owner, row untouched', async () => {
            const p = await seed();
            const { app } = testApp();
            const res = await post(app, '/project-delete', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_2_ID }));
            expect(res.json()).toEqual({ deleted: false });
            expect((await row(p.id)).deleted_at).toBeNull();
        });

        it('false when already deleted', async () => {
            const p = await seed({ deletedAt: new Date().toISOString() });
            const { app } = testApp();
            const res = await post(app, '/project-delete', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ deleted: false });
        });
    });

    describe('/project-restore', () => {
        /** Workspace whose entitlements pass/fail the Step 4 canRestore gate. */
        async function seedWs(tier: 'pro' | 'trial' | 'free') {
            const ws = await seedWorkspace(pool, tier === 'trial'
                ? { trialEndsAt: '2100-01-01T00:00:00Z' }
                : {});
            createdWorkspaces.push(ws.id);
            if (tier === 'pro') {
                await seedSubscription(pool, { workspaceId: ws.id, status: 'active' });
            }
            return ws;
        }

        it('owner restores a soft-deleted project (pro workspace)', async () => {
            const ws = await seedWs('pro');
            const p = await seed({ deletedAt: new Date().toISOString(), workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ restored: true });
            expect((await row(p.id)).deleted_at).toBeNull();
        });

        it('trial workspaces can restore too (canRestore is trial/pro)', async () => {
            const ws = await seedWs('trial');
            const p = await seed({ deletedAt: new Date().toISOString(), workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ restored: true });
        });

        it('403 subscription_required on a FREE workspace, row untouched (Step 4)', async () => {
            const ws = await seedWs('free');
            const p = await seed({ deletedAt: new Date().toISOString(), workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.statusCode).toBe(403);
            expect(res.json()).toEqual({ error: 'subscription_required' });
            expect((await row(p.id)).deleted_at).not.toBeNull();
        });

        it('false for a non-owner, row untouched — even on a free workspace (no gate leak)', async () => {
            const ws = await seedWs('free');
            const p = await seed({ deletedAt: new Date().toISOString(), workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_2_ID }));
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ restored: false });
            expect((await row(p.id)).deleted_at).not.toBeNull();
        });

        it('false for a live project', async () => {
            const ws = await seedWs('pro');
            const p = await seed({ workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ restored: false });
        });

        it('false for a permanently-deleted project', async () => {
            const ws = await seedWs('pro');
            const p = await seed({
                deletedAt: new Date().toISOString(), permanentlyDeleted: true,
                workspaceId: ws.id });
            const { app } = testApp();
            const res = await post(app, '/project-restore', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ restored: false });
        });
    });

    describe('/project-confirm-upload', () => {
        it('owner flips pending → ready', async () => {
            const p = await seed({ uploadStatus: 'pending' });
            const { app } = testApp();
            const res = await post(app, '/project-confirm-upload', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ confirmed: true });
            expect((await row(p.id)).upload_status).toBe('ready');
        });

        it('false when already ready (the client-warn case)', async () => {
            const p = await seed({ uploadStatus: 'ready' });
            const { app } = testApp();
            const res = await post(app, '/project-confirm-upload', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_ID }));
            expect(res.json()).toEqual({ confirmed: false });
        });

        it('false for a non-owner, still pending', async () => {
            const p = await seed({ uploadStatus: 'pending' });
            const { app } = testApp();
            const res = await post(app, '/project-confirm-upload', { projectId: p.id },
                await userToken({ sub: SEEDED_USER_2_ID }));
            expect(res.json()).toEqual({ confirmed: false });
            expect((await row(p.id)).upload_status).toBe('pending');
        });
    });
});
