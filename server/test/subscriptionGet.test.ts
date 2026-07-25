/**
 * POST /subscription-get — Part 2 Batch 4.
 * Pins: member gating (non-member → null, indistinguishable from
 * no-subscription), the omitted-workspaceId fallback to the oldest
 * OWNED workspace, and the fail-safe 400 for an explicit null
 * workspaceId (Ajv coerces null → "" through a string schema, minLength
 * rejects it — clients omit the key).
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
    hasTestDb,
    SEEDED_USER_2_ID,
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from './helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/subscription-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /subscription-get (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), {});
        expect(res.statusCode).toBe(401);
    });

    it('explicit null workspaceId fails SAFE with a schema 400 (coerces to "", minLength rejects)', async () => {
        const res = await post(validationApp(), { workspaceId: null }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /subscription-get (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let owner: SeededAuthUser;
    const createdWorkspaces: string[] = [];

    beforeAll(async () => {
        pool = createTestPool();
        owner = await seedAuthUser(pool);
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [owner.id]);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    it('returns the subscription blob for a member', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: owner.id });
        await seedSubscription(pool, {
            workspaceId: ws.id, userId: owner.id, plan: 'teams', status: 'active',
            billingInterval: 'yearly', seats: 6, cancelAt: '2027-01-01T00:00:00Z',
        });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        expect(body).toMatchObject({
            status: 'active',
            plan: 'teams',
            billing_interval: 'yearly',
            seats: 6,
        });
        expect(body.cancel_at as string).toContain('2027-01-01');
    });

    it('null for a NON-member of a subscribed workspace (information hiding)', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: owner.id });
        await seedSubscription(pool, { workspaceId: ws.id, userId: owner.id });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.body === '' || res.json() === null).toBe(true);
    });

    it('null when the workspace has no subscription', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: owner.id });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.body === '' || res.json() === null).toBe(true);
    });

    it('omitted workspaceId falls back to the oldest OWNED workspace', async () => {
        const older = await seedWorkspace(pool, { ownerId: owner.id });
        const newer = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(older.id, newer.id);
        await pool.query(
            `UPDATE workspaces SET created_at = now() - interval '2 days' WHERE id = $1`,
            [older.id],
        );
        await seedWorkspaceMember(pool, { workspaceId: older.id, userId: owner.id });
        await seedWorkspaceMember(pool, { workspaceId: newer.id, userId: owner.id });
        await seedSubscription(pool, { workspaceId: older.id, userId: owner.id, status: 'trialing' });
        await seedSubscription(pool, { workspaceId: newer.id, userId: owner.id, status: 'active' });

        const res = await post(testApp(), {},
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'trialing' });
    });
});
