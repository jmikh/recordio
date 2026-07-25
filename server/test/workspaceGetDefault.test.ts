/**
 * POST /workspace-get-default — Part 2 Batch 4: the session bootstrap.
 * Heal-chain pins (parity with workspace_get_default): stored default →
 * stale-default fallback → create-if-none. Dedicated auth users per
 * test — the chain mutates default_workspace_id and creates workspaces.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteWorkspaces,
    getDefaultWorkspaceId,
    hasTestDb,
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
} from './helpers/db.js';

async function post(app: App, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-get-default',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: {},
    });
}

describe('POST /workspace-get-default (auth, no db)', () => {
    it('401 without a token', async () => {
        const app = buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app);
        expect(res.statusCode).toBe(401);
    });
});

describe.runIf(hasTestDb())('POST /workspace-get-default (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
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

    async function freshUser() {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        return user;
    }

    it('bootstrap: a brand-new user gets "My Workspace" created, joined as admin, and set as default', async () => {
        const user = await freshUser();
        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);

        const body = res.json() as Record<string, unknown>;
        createdWorkspaces.push(body.id as string);
        expect(body).toMatchObject({
            name: 'My Workspace',
            owner_id: user.id,
            role: 'admin',
            seats: null,
        });
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(body.id);
    });

    it('returns the stored default when the membership is still live (with subscription seats)', async () => {
        const user = await freshUser();
        const owned = await seedWorkspace(pool, { ownerId: user.id, name: 'Owned older' });
        const stored = await seedWorkspace(pool, { name: 'Joined workspace' }); // owned by SEEDED user
        createdWorkspaces.push(owned.id, stored.id);
        await seedWorkspaceMember(pool, { workspaceId: owned.id, userId: user.id });
        await seedWorkspaceMember(pool, { workspaceId: stored.id, userId: user.id, role: 'creator' });
        await seedSubscription(pool, { workspaceId: stored.id, plan: 'teams', seats: 4 });
        await pool.query(
            'UPDATE user_profiles SET default_workspace_id = $1 WHERE user_id = $2',
            [stored.id, user.id],
        );

        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            id: stored.id,
            name: 'Joined workspace',
            role: 'creator',
            seats: 4,
        });
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(stored.id);
    });

    it('stale default (deleted workspace) falls back to the oldest owned live workspace and heals the profile', async () => {
        const user = await freshUser();
        const dead = await seedWorkspace(pool, { ownerId: user.id, deletedAt: new Date().toISOString() });
        const older = await seedWorkspace(pool, { ownerId: user.id, name: 'Oldest owned' });
        const newer = await seedWorkspace(pool, { ownerId: user.id, name: 'Newer owned' });
        createdWorkspaces.push(dead.id, older.id, newer.id);
        // Make `older` genuinely older than `newer`
        await pool.query(
            `UPDATE workspaces SET created_at = now() - interval '1 day' WHERE id = $1`,
            [older.id],
        );
        for (const wsId of [dead.id, older.id, newer.id]) {
            await seedWorkspaceMember(pool, { workspaceId: wsId, userId: user.id });
        }
        await pool.query(
            'UPDATE user_profiles SET default_workspace_id = $1 WHERE user_id = $2',
            [dead.id, user.id],
        );

        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: older.id, name: 'Oldest owned', role: 'admin' });
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(older.id);
    });
});
