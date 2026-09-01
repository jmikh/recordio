/**
 * POST /subscription-get — billing revamp Step 1 contract.
 * Pins: members always get { subscription, entitlements } (free/trial
 * workspaces have subscription: null + real entitlements), non-members
 * get 403 (the old null-for-non-member hiding can't carry
 * entitlements), the omitted-workspaceId fallback to the oldest OWNED
 * workspace, and the fail-safe 400 for an explicit null workspaceId
 * (Ajv coerces null → "" through a string schema, minLength rejects it
 * — clients omit the key).
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
    hasTestDb,
    SEEDED_USER_2_ID,
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from '../helpers/db.js';

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

    it('returns the subscription blob + pro entitlements for the owner of a subscribed workspace', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, {
            workspaceId: ws.id, userId: owner.id, status: 'active',
            billingInterval: 'yearly', seats: 6, cancelAt: '2027-01-01T00:00:00Z',
        });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, Record<string, unknown>>;
        expect(body.subscription).toMatchObject({
            status: 'active',
            billing_interval: 'yearly',
            seats: 6,
        });
        expect(body.subscription.cancel_at as string).toContain('2027-01-01');
        expect(body.entitlements).toEqual({
            state: 'pro',
            canShare: true,
            canTranscribe: true,
            canBackgroundExport: true,
            can4k: true,
            canInvite: true,
            projectCap: null,
            trialEndsAt: null,
            canExtendTrial: false,
        });
    });

    it('403 for a NON-member of a subscribed workspace', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, userId: owner.id });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
    });

    it('subscription null + FREE entitlements when the workspace has no subscription and an expired trial', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        const body = res.json() as { subscription: unknown; entitlements: Record<string, unknown> };
        expect(body.subscription).toBeNull();
        expect(body.entitlements).toMatchObject({
            state: 'free',
            canShare: false,
            canTranscribe: false,
            canBackgroundExport: false,
            can4k: false,
            canInvite: false,
            trialEndsAt: null,
            canExtendTrial: true, // expired unused trial, never-pro (Step 3)
        });
        expect(body.entitlements.projectCap).toBeGreaterThanOrEqual(1);
    });

    it('subscription null + TRIAL entitlements while the WORKSPACE trial is live', async () => {
        // Trial pinned after the fakeClock (2026-01-01)
        const ws = await seedWorkspace(pool, {
            ownerId: owner.id,
            trialEndsAt: '2026-06-01T00:00:00Z',
        });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            subscription: null,
            entitlements: {
                state: 'trial',
                canShare: true,
                canTranscribe: true,
                canBackgroundExport: true,
                can4k: true,
                canInvite: false, // trials are solo
                projectCap: null,
                trialEndsAt: '2026-06-01T00:00:00.000Z',
                canExtendTrial: false, // live trial — the offer is post-lapse only
            },
        });
    });

    it('one-way door: a canceled subscription pins the workspace FREE even with a live trial', async () => {
        const ws = await seedWorkspace(pool, {
            ownerId: owner.id,
            trialEndsAt: '2026-06-01T00:00:00Z',
        });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, userId: owner.id, status: 'canceled' });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            subscription: { status: 'canceled' },
            entitlements: {
                state: 'free',
                canShare: false,
                trialEndsAt: null,
                canExtendTrial: false, // ever-pro never extends
            },
        });
    });

    it('omitted workspaceId falls back to the oldest OWNED workspace', async () => {
        const older = await seedWorkspace(pool, { ownerId: owner.id });
        const newer = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(older.id, newer.id);
        await pool.query(
            `UPDATE workspaces SET created_at = now() - interval '2 days' WHERE id = $1`,
            [older.id],
        );
        await seedSubscription(pool, { workspaceId: older.id, userId: owner.id, status: 'trialing' });
        await seedSubscription(pool, { workspaceId: newer.id, userId: owner.id, status: 'active' });

        const res = await post(testApp(), {},
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ subscription: { status: 'trialing' } });
    });
});
