/**
 * POST /project-editor-set + /project-editor-remove — individual grant
 * management (share-access model). OWNER-only; targets must be live
 * workspace members; set is canShare-gated, remove never is.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteProjects,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedAuthUser,
    seedProject,
    seedProjectEditor,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from '../helpers/db.js';

async function post(app: App, url: string, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('project editor routes (auth + validation, no db)', () => {
    function validationApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps();
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app, deps };
    }

    it.each(['/project-editor-set', '/project-editor-remove'])(
        '%s: 401 without a token', async (url) => {
            const { app } = validationApp();
            const res = await post(app, url, { projectId: 'p-1', userId: 'u-1', role: 'view' });
            expect(res.statusCode).toBe(401);
        });

    it('schema 400 pre-query: invalid role', async () => {
        const { app } = validationApp();
        const res = await post(app, '/project-editor-set',
            { projectId: 'p-1', userId: 'u-1', role: 'owner' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });

    it('schema 400 pre-query: set requires role', async () => {
        const { app } = validationApp();
        const res = await post(app, '/project-editor-set',
            { projectId: 'p-1', userId: 'u-1' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('project editor routes (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];
    /** Subscribed workspace owned by SEEDED_USER_ID; user2 is a member */
    let subscribedWs: string;
    /** A user OUTSIDE the workspace — invalid grant target */
    let outsider: SeededAuthUser;

    beforeAll(async () => {
        pool = createTestPool();
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, status: 'active' });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        subscribedWs = ws.id;
        outsider = await seedAuthUser(pool);
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [outsider.id]);
        await pool.end();
    });

    function testApp() {
        const deps = createFakeDeps({ db: pool });
        const app = buildApp(deps, { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        return { app };
    }

    async function seed(opts: Parameters<typeof seedProject>[1] = {}) {
        const p = await seedProject(pool, { workspaceId: subscribedWs, ...opts });
        createdProjects.push(p.id);
        return p;
    }

    async function grants(projectId: string) {
        const { rows } = await pool.query(
            'SELECT user_id, role FROM project_editors WHERE project_id = $1', [projectId]);
        return rows as { user_id: string; role: string }[];
    }

    it('set inserts a grant and returns the editors list; upsert updates the role', async () => {
        const p = await seed();
        const { app } = testApp();

        const res = await post(app, '/project-editor-set',
            { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        const { editors } = res.json() as { editors: Array<Record<string, unknown>> };
        expect(editors).toHaveLength(1);
        expect(editors[0]).toMatchObject({
            user_id: SEEDED_USER_2_ID,
            email: 'user2@gmail.com',
            role: 'view',
        });

        const res2 = await post(app, '/project-editor-set',
            { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'edit' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res2.statusCode).toBe(200);
        expect(await grants(p.id)).toEqual([{ user_id: SEEDED_USER_2_ID, role: 'edit' }]);
    });

    it('remove deletes the grant and is idempotent', async () => {
        const p = await seed();
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' });
        const { app } = testApp();

        const res = await post(app, '/project-editor-remove',
            { projectId: p.id, userId: SEEDED_USER_2_ID },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect((res.json() as { editors: unknown[] }).editors).toEqual([]);
        expect(await grants(p.id)).toEqual([]);

        // second remove: still 200 (idempotent)
        const res2 = await post(app, '/project-editor-remove',
            { projectId: p.id, userId: SEEDED_USER_2_ID },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res2.statusCode).toBe(200);
    });

    it.each([
        ['set', '/project-editor-set', { role: 'view' }],
        ['remove', '/project-editor-remove', {}],
    ])('403 for a non-owner caller on %s (owner-only, even with an edit grant)', async (_n, url, extra) => {
        const p = await seed();
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'edit' });
        const { app } = testApp();

        const res = await post(app, url,
            { projectId: p.id, userId: SEEDED_USER_2_ID, ...extra },
            await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Only the project owner can manage project sharing' });
    });

    it.each([
        ['set', '/project-editor-set', { role: 'view' }],
        ['remove', '/project-editor-remove', {}],
    ])('404 for an unknown project on %s', async (_n, url, extra) => {
        const { app } = testApp();
        const res = await post(app, url,
            { projectId: randomUUID(), userId: SEEDED_USER_2_ID, ...extra },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Project not found' });
    });

    it('400 when the target is not a member of the project workspace', async () => {
        const p = await seed();
        const { app } = testApp();

        const res = await post(app, '/project-editor-set',
            { projectId: p.id, userId: outsider.id, role: 'view' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'User is not a member of this workspace' });
        expect(await grants(p.id)).toEqual([]);
    });

    it('400 when granting edit to a viewer-role member (seat guard); view is fine', async () => {
        const viewer = await seedAuthUser(pool);
        await seedWorkspaceMember(pool, {
            workspaceId: subscribedWs, userId: viewer.id, role: 'viewer' });
        const p = await seed();
        const { app } = testApp();

        const editRes = await post(app, '/project-editor-set',
            { projectId: p.id, userId: viewer.id, role: 'edit' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(editRes.statusCode).toBe(400);
        expect(editRes.json()).toEqual({ error: 'Viewers cannot be granted edit access' });

        const viewRes = await post(app, '/project-editor-set',
            { projectId: p.id, userId: viewer.id, role: 'view' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(viewRes.statusCode).toBe(200);

        await deleteProjects(pool, [p.id]);
        createdProjects.length = 0;
        await deleteAuthUsers(pool, [viewer.id]);
    });

    it('400 when the target is the owner', async () => {
        const p = await seed();
        const { app } = testApp();

        const res = await post(app, '/project-editor-set',
            { projectId: p.id, userId: SEEDED_USER_ID, role: 'edit' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Owner already has access' });
    });

    it('set is 403 subscription_required in a free workspace; remove still works', async () => {
        const freeOwner = await seedAuthUser(pool);
        const ws = await seedWorkspace(pool, { ownerId: freeOwner.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID });
        const p = await seed({ ownerId: freeOwner.id, workspaceId: ws.id });
        // Pre-existing grant (e.g. from a lapsed subscription era)
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'edit' });
        const { app } = testApp();

        const setRes = await post(app, '/project-editor-set',
            { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' },
            await userToken({ sub: freeOwner.id }));
        expect(setRes.statusCode).toBe(403);
        expect(setRes.json()).toEqual({ error: 'subscription_required' });
        expect(await grants(p.id)).toEqual([{ user_id: SEEDED_USER_2_ID, role: 'edit' }]);

        const removeRes = await post(app, '/project-editor-remove',
            { projectId: p.id, userId: SEEDED_USER_2_ID },
            await userToken({ sub: freeOwner.id }));
        expect(removeRes.statusCode).toBe(200);
        expect(await grants(p.id)).toEqual([]);

        await deleteProjects(pool, [p.id]);
        await deleteAuthUsers(pool, [freeOwner.id]);
    });
});
