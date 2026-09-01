/**
 * POST /trial-extend — billing revamp Step 3 contract.
 * Pins: owner-only (invited members get 403, same stance as
 * subscription-get), the eligibility guard (trial already ended +
 * extension unused + never-pro — any subscriptions row refuses,
 * canceled included), +7 days from the extension date on the FAKE
 * clock (the route passes clock.now() into SQL), and atomicity —
 * concurrent requests can never double-grant.
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
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
    type SeededAuthUser,
} from '../helpers/db.js';

// createFakeClock pins now at 2026-01-01; the grant is now + 7 days.
const EXTENDED_TRIAL_END = '2026-01-08T00:00:00.000Z';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/trial-extend',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /trial-extend (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { workspaceId: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it('400 without a workspaceId', async () => {
        const res = await post(validationApp(), {}, await userToken());
        expect(res.statusCode).toBe(400);
    });

    it('400 for an empty workspaceId', async () => {
        const res = await post(validationApp(), { workspaceId: '' }, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /trial-extend (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    let owner: SeededAuthUser;
    let member: SeededAuthUser;
    const createdWorkspaces: string[] = [];

    beforeAll(async () => {
        pool = createTestPool();
        owner = await seedAuthUser(pool);
        member = await seedAuthUser(pool);
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await deleteAuthUsers(pool, [owner.id, member.id]);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    async function workspaceTrialRow(id: string) {
        const { rows } = await pool.query(
            'SELECT trial_ends_at, trial_extension_count FROM workspaces WHERE id = $1',
            [id],
        );
        return rows[0] as { trial_ends_at: Date; trial_extension_count: number };
    }

    it('grants +7 days from the extension date and returns trial entitlements', async () => {
        // seedWorkspace default: trial expired 2020-01-01, count 0, never-pro
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            entitlements: {
                state: 'trial',
                canShare: true,
                canTranscribe: true,
                canBackgroundExport: true,
                can4k: true,
                canInvite: false, // trials are solo
                canRestore: true,
                projectCap: null,
                trialEndsAt: EXTENDED_TRIAL_END,
                canExtendTrial: false, // the one extension is now spent
            },
        });

        const row = await workspaceTrialRow(ws.id);
        expect(row.trial_ends_at.toISOString()).toBe(EXTENDED_TRIAL_END);
        expect(row.trial_extension_count).toBe(1);
    });

    it('403 for an invited member — owner-only', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: member.id, role: 'admin' });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: member.id, email: member.email }));
        expect(res.statusCode).toBe(403);
        expect((await workspaceTrialRow(ws.id)).trial_extension_count).toBe(0);
    });

    it('404 for an unknown workspace', async () => {
        const res = await post(testApp(), { workspaceId: '00000000-0000-4000-8000-000000000000' },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(404);
    });

    it('404 for a soft-deleted workspace', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id, deletedAt: '2026-01-01T00:00:00Z' });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(404);
    });

    it('409 trial_active while the trial is still live — no mid-trial extension', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id, trialEndsAt: '2026-06-01T00:00:00Z' });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ reason: 'trial_active' });

        const row = await workspaceTrialRow(ws.id);
        expect(row.trial_ends_at.toISOString()).toBe('2026-06-01T00:00:00.000Z');
        expect(row.trial_extension_count).toBe(0);
    });

    it('409 already_extended once the one extension is spent', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id, trialExtensionCount: 1 });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ reason: 'already_extended' });
        expect((await workspaceTrialRow(ws.id)).trial_extension_count).toBe(1);
    });

    it('409 ever_pro for a workspace with a canceled subscription (one-way door)', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, { workspaceId: ws.id, userId: owner.id, status: 'canceled' });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: owner.id, email: owner.email }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ reason: 'ever_pro' });
        expect((await workspaceTrialRow(ws.id)).trial_extension_count).toBe(0);
    });

    it('concurrent requests grant exactly once (atomic guard)', async () => {
        const ws = await seedWorkspace(pool, { ownerId: owner.id });
        createdWorkspaces.push(ws.id);
        const token = await userToken({ sub: owner.id, email: owner.email });
        const app = testApp();

        const [a, b] = await Promise.all([
            post(app, { workspaceId: ws.id }, token),
            post(app, { workspaceId: ws.id }, token),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

        const row = await workspaceTrialRow(ws.id);
        expect(row.trial_ends_at.toISOString()).toBe(EXTENDED_TRIAL_END);
        expect(row.trial_extension_count).toBe(1);
    });
});
