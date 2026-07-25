/**
 * POST /workspace-member-update-role — Part 2 Batch 3.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-member-update-role',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-member-update-role (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', userId: 'y', role: 'viewer' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: invalid role', async () => {
        const res = await post(validationApp(),
            { workspaceId: 'x', userId: 'y', role: 'owner' }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-member-update-role (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    async function workspaceWithBoth() {
        const ws = await seedWorkspace(pool); // owner: SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' });
        return ws;
    }

    it('403 for a non-admin caller; role untouched', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp(),
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'viewer' }]);
    });

    it("409 changing the owner's role", async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp(),
            { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'Cannot change the role of the workspace owner' });
    });

    it('404 for a non-member target', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp(),
            { workspaceId: ws.id, userId: randomUUID(), role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
    });

    it('updates the role for an admin', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp(),
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });

        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [ws.id, SEEDED_USER_2_ID]);
        expect(rows).toEqual([{ role: 'creator' }]);
    });
});
