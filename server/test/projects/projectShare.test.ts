/**
 * POST /project-share — Part 2 Batch 2, reshaped by the share-access
 * model: OWNER-only (stricter than the editor routes — pinned); slugs
 * are permanent (DB default at insert); the route applies policy +
 * workspace access and enforces the override rule on individual grants.
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
    type SeededAuthUser,
} from '../helpers/db.js';

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

    it('schema 400 pre-query: invalid workspaceAccess', async () => {
        const { app } = validationApp();
        const res = await post(app, { projectId: 'p-1', workspaceAccess: 'admin' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /project-share (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdWorkspaces: string[] = [];
    /** Subscribed workspace — the share gate needs canShare (revamp Step 1) */
    let subscribedWs: string;
    /** Trial-less owner: the fakeClock (2026-01-01) predates the SEEDED users' trials */
    let freeOwner: SeededAuthUser;
    /** Second grantee for the override-rule matrix (user2 is the first) */
    let grantee: SeededAuthUser;

    beforeAll(async () => {
        pool = createTestPool();
        const ws = await seedWorkspace(pool, { ownerId: SEEDED_USER_ID });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, status: 'active' });
        subscribedWs = ws.id;
        freeOwner = await seedAuthUser(pool);
        grantee = await seedAuthUser(pool);
    });
    afterEach(async () => {
        await deleteProjects(pool, createdProjects);
        createdProjects.length = 0;
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [freeOwner.id, grantee.id]);
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

    async function row(id: string) {
        const { rows } = await pool.query(
            'SELECT slug, share_policy, workspace_access FROM projects WHERE id = $1', [id]);
        return rows[0] as { slug: string; share_policy: string; workspace_access: string };
    }

    async function editorRoles(projectId: string) {
        const { rows } = await pool.query(
            'SELECT user_id, role FROM project_editors WHERE project_id = $1 ORDER BY role',
            [projectId]);
        return rows as { user_id: string; role: string }[];
    }

    it('omitted sharePolicy still means public (pre-modal wire compat) and keeps the slug', async () => {
        const p = await seed({ sharePolicy: 'private' });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ slug: p.slug, isNew: false });
        expect(await row(p.id)).toEqual({
            slug: p.slug, share_policy: 'public', workspace_access: 'view',
        });
    });

    it('applies policy + workspaceAccess together; omitted access keeps the current level', async () => {
        const p = await seed({ sharePolicy: 'private' });
        const { app } = testApp();

        await post(app, { projectId: p.id, sharePolicy: 'workspace', workspaceAccess: 'edit' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(await row(p.id)).toEqual({
            slug: p.slug, share_policy: 'workspace', workspace_access: 'edit',
        });

        // access omitted → stays edit
        await post(app, { projectId: p.id, sharePolicy: 'public' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(await row(p.id)).toEqual({
            slug: p.slug, share_policy: 'public', workspace_access: 'edit',
        });
    });

    // Override rule: a policy granting the workspace view erases
    // individual view grants; workspace edit erases ALL grants;
    // private erases nothing.
    it('workspace-view share deletes view grants and keeps edit grants', async () => {
        const p = await seed({ sharePolicy: 'private' });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' });
        await seedProjectEditor(pool, { projectId: p.id, userId: grantee.id, role: 'edit' });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id, sharePolicy: 'workspace' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(await editorRoles(p.id)).toEqual([{ user_id: grantee.id, role: 'edit' }]);
    });

    it('workspace-edit share deletes ALL individual grants', async () => {
        const p = await seed({ sharePolicy: 'private' });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' });
        await seedProjectEditor(pool, { projectId: p.id, userId: grantee.id, role: 'edit' });
        const { app } = testApp();

        const res = await post(app,
            { projectId: p.id, sharePolicy: 'public', workspaceAccess: 'edit' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(await editorRoles(p.id)).toEqual([]);
    });

    it('setting private keeps all individual grants', async () => {
        const p = await seed({ sharePolicy: 'public' });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID, role: 'view' });
        await seedProjectEditor(pool, { projectId: p.id, userId: grantee.id, role: 'edit' });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id, sharePolicy: 'private' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect(await editorRoles(p.id)).toHaveLength(2);
        expect((await row(p.id)).share_policy).toBe('private');
    });

    it('403 with the exact body for an EDITOR (owner-only, stricter than editor routes)', async () => {
        const p = await seed({ sharePolicy: 'private' });
        await seedProjectEditor(pool, { projectId: p.id, userId: SEEDED_USER_2_ID });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_2_ID }));

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Only the project owner can share a project' });
        expect((await row(p.id)).share_policy).toBe('private');
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

    // Billing revamp Step 1: share links are trial/Pro — a FREE
    // workspace (no subscription, owner without a trial) is denied
    it('403 subscription_required for the owner in a free workspace', async () => {
        const ws = await seedWorkspace(pool, { ownerId: freeOwner.id });
        createdWorkspaces.push(ws.id);
        const p = await seed({ workspaceId: ws.id, sharePolicy: 'private' });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'subscription_required' });
        expect((await row(p.id)).share_policy).toBe('private');
    });

    it('sharePolicy private is allowed WITHOUT a subscription (un-share must always work)', async () => {
        const ws = await seedWorkspace(pool, { ownerId: freeOwner.id });
        createdWorkspaces.push(ws.id);
        const p = await seed({ workspaceId: ws.id, sharePolicy: 'public' });
        const { app } = testApp();

        const res = await post(app, { projectId: p.id, sharePolicy: 'private' },
            await userToken({ sub: SEEDED_USER_ID }));

        expect(res.statusCode).toBe(200);
        expect((await row(p.id)).share_policy).toBe('private');
    });
});
