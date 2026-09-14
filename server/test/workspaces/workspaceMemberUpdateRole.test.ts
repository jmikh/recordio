/**
 * POST /workspace-member-update-role — Part 2 Batch 3; seat
 * pre-purchase (plans/seat-prepurchase-oneshot.md): promoting a viewer
 * to creator/admin occupies a purchased seat, so it is gated on an
 * active subscription AND a free seat (pending creator/admin invitations
 * reserve seats); downgrades and admin↔creator changes are never gated.
 * Nothing touches Stripe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { NO_SEATS_AVAILABLE_ERROR } from '../../src/services/seatBilling.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceInvitation,
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

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool }) as FakeDeps;
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    /** Owner SEEDED_USER_ID + member SEEDED_USER_2_ID; seats default to 2 (one free for a promotion). */
    async function workspaceWithBoth(
        opts: { memberRole?: 'viewer' | 'creator' | 'admin'; subscribed?: boolean; seats?: number } = {},
    ) {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, {
            workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: opts.memberRole ?? 'viewer',
        });
        if (opts.subscribed !== false) {
            await seedSubscription(pool, { workspaceId: ws.id, seats: opts.seats ?? 2 });
        }
        return ws;
    }

    async function roleOf(workspaceId: string) {
        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspaceId, SEEDED_USER_2_ID]);
        return rows as Array<{ role: string }>;
    }

    it('403 for a non-admin caller; role untouched', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);
    });

    it("409 changing the owner's role", async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'Cannot change the role of the workspace owner' });
    });

    it('404 for a non-member target', async () => {
        const ws = await workspaceWithBoth();
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: randomUUID(), role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
    });

    it('viewer→creator promotion with a free seat: 200, role written, Stripe untouched', async () => {
        const ws = await workspaceWithBoth({ seats: 2 });
        const { app, deps } = testApp();

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(await roleOf(ws.id)).toEqual([{ role: 'creator' }]);
        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        expect(deps.email.sent).toEqual([]);
    });

    it('viewer→creator promotion at capacity → 403 with the seat message; role untouched', async () => {
        const ws = await workspaceWithBoth({ seats: 1 }); // owner fills the only seat
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: NO_SEATS_AVAILABLE_ERROR });
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);
    });

    it('pending creator invitations reserve seats against promotions too', async () => {
        const ws = await workspaceWithBoth({ seats: 2 });
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'reserved@example.com', role: 'creator' });

        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: NO_SEATS_AVAILABLE_ERROR });
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);
    });

    it('creator→viewer downgrade: no Stripe call, purchased seats unchanged', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'creator', seats: 2 });
        const { app, deps } = testApp();

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);

        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        const { rows } = await pool.query(
            'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([{ seats: 2 }]);
    });

    it('admin→creator needs no seat (they already hold one): 200 even in an over-capacity workspace', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'admin', seats: 1 });
        const { app, deps } = testApp();

        const res = await post(app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(await roleOf(ws.id)).toEqual([{ role: 'creator' }]);
        expect(deps.stripe.subscriptionUpdates).toEqual([]);
    });

    it('403 promoting on a workspace without an active subscription; role untouched', async () => {
        const ws = await workspaceWithBoth({ subscribed: false });
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Promoting members requires an active subscription' });
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);
    });

    it('creator→viewer downgrade on a lapsed workspace still works (shrinking is never gated)', async () => {
        const ws = await workspaceWithBoth({ memberRole: 'creator', subscribed: false });
        const res = await post(testApp().app,
            { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(await roleOf(ws.id)).toEqual([{ role: 'viewer' }]);
    });
});
