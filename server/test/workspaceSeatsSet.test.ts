/**
 * POST /workspace-seats-set — Part 2 Batch 3.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-seats-set',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-seats-set (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x', seats: 2 });
        expect(res.statusCode).toBe(401);
    });

    it.each([
        ['missing seats', { workspaceId: 'x' }],
        ['seats below 1', { workspaceId: 'x', seats: 0 }],
    ])('schema 400 pre-query: %s', async (_name, body) => {
        const res = await post(validationApp(), body, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-seats-set (e2e, real Postgres)', () => {
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

    async function adminWorkspace() {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
        return ws;
    }

    it('403 for a non-admin', async () => {
        const ws = await adminWorkspace();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        await seedSubscription(pool, { workspaceId: ws.id, plan: 'teams', seats: 2 });

        const res = await post(testApp(), { workspaceId: ws.id, seats: 9 },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
    });

    it('404 when the workspace has no subscription', async () => {
        const ws = await adminWorkspace();
        const res = await post(testApp(), { workspaceId: ws.id, seats: 2 },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'No subscription found for this workspace' });
    });

    it('updates the seat count for an admin', async () => {
        const ws = await adminWorkspace();
        await seedSubscription(pool, { workspaceId: ws.id, plan: 'teams', seats: 2 });

        const res = await post(testApp(), { workspaceId: ws.id, seats: 5 },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ seats: 5 });

        const { rows } = await pool.query(
            'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([{ seats: 5 }]);
    });
});
