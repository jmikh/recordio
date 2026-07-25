/**
 * POST /workspace-member-remove — Part 2 Batch 3.
 * The transfer pin: the removed member's LIVE projects in this
 * workspace repoint to the CALLING admin (not the workspace owner),
 * their project_editors rows in the workspace are stripped, and the
 * membership is deleted. Dedicated auth user as the removal target.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
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
    seedWorkspace,
    seedWorkspaceMember,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-member-remove',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-member-remove (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', userId: 'y' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing userId', async () => {
        const res = await post(validationApp(), { workspaceId: 'x' }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-member-remove (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];
    const createdWorkspaces: string[] = [];
    const createdProjects: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteProjects(pool, createdProjects);
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, createdUsers);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    async function workspaceWithAdmin() {
        const ws = await seedWorkspace(pool); // owner: SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
        return ws;
    }

    it('403 for a non-admin caller', async () => {
        const ws = await workspaceWithAdmin();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });

        const res = await post(testApp(), { workspaceId: ws.id, userId: SEEDED_USER_ID },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
    });

    it('409 removing the workspace owner', async () => {
        const ws = await workspaceWithAdmin();
        const res = await post(testApp(), { workspaceId: ws.id, userId: SEEDED_USER_ID },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'Cannot remove the workspace owner' });
    });

    it('404 for a non-member target', async () => {
        const ws = await workspaceWithAdmin();
        const res = await post(testApp(), { workspaceId: ws.id, userId: randomUUID() },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Member not found in workspace' });
    });

    it('removes the member: live projects transfer to the CALLER, editor rows stripped, membership gone', async () => {
        const ws = await workspaceWithAdmin();
        const member = await seedAuthUser(pool);
        createdUsers.push(member.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: member.id, role: 'creator' });

        const live1 = await seedProject(pool, { ownerId: member.id, workspaceId: ws.id, uploadStatus: 'ready' });
        const live2 = await seedProject(pool, { ownerId: member.id, workspaceId: ws.id, uploadStatus: 'ready' });
        const deleted = await seedProject(pool, {
            ownerId: member.id, workspaceId: ws.id, deletedAt: new Date().toISOString(),
        });
        const adminProject = await seedProject(pool, { ownerId: SEEDED_USER_ID, workspaceId: ws.id });
        createdProjects.push(live1.id, live2.id, deleted.id, adminProject.id);
        await seedProjectEditor(pool, { projectId: adminProject.id, userId: member.id });

        const res = await post(testApp(), { workspaceId: ws.id, userId: member.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ transferredCount: 2 });

        const { rows: owners } = await pool.query(
            'SELECT id, owner_id FROM projects WHERE id = ANY($1::uuid[]) ORDER BY id',
            [[live1.id, live2.id, deleted.id].sort()],
        );
        for (const row of owners as Array<{ id: string; owner_id: string }>) {
            expect(row.owner_id).toBe(row.id === deleted.id ? member.id : SEEDED_USER_ID);
        }

        const { rows: editorRows } = await pool.query(
            'SELECT 1 FROM project_editors WHERE project_id = $1 AND user_id = $2',
            [adminProject.id, member.id],
        );
        expect(editorRows).toEqual([]);

        const { rows: memberRows } = await pool.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, member.id],
        );
        expect(memberRows).toEqual([]);
    });
});
