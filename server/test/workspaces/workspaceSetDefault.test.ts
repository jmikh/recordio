/**
 * POST /workspace-set-default — Part 2 Batch 3.
 * Dedicated auth user: the route mutates default_workspace_id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { createFakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteWorkspaces,
    getDefaultWorkspaceId,
    hasTestDb,
    seedAuthUser,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-set-default',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-set-default (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing workspaceId', async () => {
        const res = await post(validationApp(), {}, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-set-default (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let user: SeededAuthUser;
    const createdWorkspaces: string[] = [];

    beforeAll(async () => {
        pool = createTestPool();
        user = await seedAuthUser(pool);
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [user.id]);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    it('403 for a non-member; the stored default is untouched', async () => {
        const other = await seedWorkspace(pool); // owned by SEEDED_USER_ID
        createdWorkspaces.push(other.id);

        const before = await getDefaultWorkspaceId(pool, user.id);
        const res = await post(testApp(), { workspaceId: other.id },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(403);
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(before);
    });

    it('persists the default for a member', async () => {
        const ws = await seedWorkspace(pool, { ownerId: user.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: user.id, role: 'viewer' });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(ws.id);
    });
});
