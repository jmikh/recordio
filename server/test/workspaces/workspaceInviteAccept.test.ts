/**
 * POST /workspace-invite-accept — Part 2 Batch 3; seat pre-purchase
 * (plans/seat-prepurchase-oneshot.md).
 * Business failures come back as 200 + { error } with the SQL fn's
 * EXACT messages (AcceptInvitePage displays them). Dedicated auth users
 * — accepting mutates default_workspace_id, and the email-match check
 * needs the token's email claim to line up with the invitation.
 *
 * Acceptance requires the workspace to still be pro (lapse guard) and,
 * for creator/admin roles, a free purchased seat (used < purchased —
 * the belt under the invite-time reservation). Nothing touches Stripe
 * or email: seats are bought in advance, never on acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { buildApp, type App } from '../../src/app.js';
import { ACCEPT_NO_SEATS_ERROR } from '../../src/services/seatBilling.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { TEST_JWT_SECRET, userToken } from '../helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    deleteWorkspaces,
    getDefaultWorkspaceId,
    hasTestDb,
    seedAuthUser,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceInvitation,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-invite-accept',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-invite-accept (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { token: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing token', async () => {
        const res = await post(validationApp(), {}, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-invite-accept (e2e, real Postgres)', () => {
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

    function testApp(): { app: App; deps: FakeDeps } {
        const deps = createFakeDeps({ db: pool }) as FakeDeps;
        const app = buildApp(deps, {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
        return { app, deps };
    }

    async function freshUser() {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        return user;
    }

    /**
     * Pro workspace (owner SEEDED_USER_ID = user1@gmail.com). Seats
     * default to 2: the owner's plus one free seat for the invitee.
     */
    async function freshWorkspace(opts: { status?: string; seats?: number } = {}) {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        await seedSubscription(pool, {
            workspaceId: ws.id,
            status: opts.status ?? 'active',
            seats: opts.seats ?? 2,
        });
        return ws;
    }

    async function memberRole(workspaceId: string, userId: string) {
        const { rows } = await pool.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspaceId, userId],
        );
        return rows as Array<{ role: string }>;
    }

    it("unknown token → 200 { error: 'Invitation not found or already used' }", async () => {
        const user = await freshUser();
        const res = await post(testApp().app, { token: randomUUID() },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'Invitation not found or already used' });
    });

    it('email mismatch → the exact user-facing message; nothing joined', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: 'someone-else@example.com',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'This invitation was sent to a different email address' });
        expect(await memberRole(ws.id, user.id)).toEqual([]);
    });

    it('accepts: joins with the invitation role, deletes the invitation, sets the default workspace; a second accept fails used', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace();
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email.toUpperCase(), role: 'creator',
        });

        const { app } = testApp();
        const t = await userToken({ sub: user.id, email: user.email });
        const res = await post(app, { token: inv.token }, t);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'creator' });

        expect(await memberRole(ws.id, user.id)).toEqual([{ role: 'creator' }]);
        const { rows: invRows } = await pool.query(
            'SELECT status FROM workspace_invitations WHERE id = $1', [inv.id]);
        expect(invRows).toEqual([]);
        expect(await getDefaultWorkspaceId(pool, user.id)).toBe(ws.id);

        const again = await post(testApp().app, { token: inv.token }, t);
        expect(again.json()).toEqual({ error: 'Invitation not found or already used' });
    });

    it('creator acceptance never touches Stripe or email; purchased seats unchanged', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 2 });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const { app, deps } = testApp();
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'creator' });

        expect(deps.stripe.subscriptionUpdates).toEqual([]);
        expect(deps.email.sent).toEqual([]);
        const { rows } = await pool.query(
            'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
        expect(rows).toEqual([{ seats: 2 }]);
    });

    it('no free seat (used == purchased) → 200 { error }, no member row', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 1 }); // owner fills the only seat
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: ACCEPT_NO_SEATS_ERROR });
        expect(await memberRole(ws.id, user.id)).toEqual([]);

        const { rows } = await pool.query(
            'SELECT status FROM workspace_invitations WHERE id = $1', [inv.id]);
        expect(rows).toEqual([{ status: 'pending' }]);
    });

    it('viewer acceptance needs no seat: joins a full workspace, Stripe untouched', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 1 });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'viewer',
        });

        const { app, deps } = testApp();
        const res = await post(app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'viewer' });
        expect(deps.stripe.subscriptionUpdates).toEqual([]);
    });

    it("lapsed workspace → 200 { error }, no member row (lapse guard)", async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ status: 'canceled' });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: "This workspace's subscription is no longer active" });
        expect(await memberRole(ws.id, user.id)).toEqual([]);
    });

    it('owner accepting an invite to their OWN workspace → error, no member row created', async () => {
        // Stale pre-guard invitations for the owner's email must not
        // recreate an owner member row (revamp Step 2: owner is its own
        // state, never in workspace_members).
        const user = await freshUser();
        const ws = await seedWorkspace(pool, { ownerId: user.id });
        createdWorkspaces.push(ws.id);
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ error: 'You already own this workspace' });
        expect(await memberRole(ws.id, user.id)).toHaveLength(0);
    });

    it('re-inviting an existing viewer as admin UPSERTS the role — it needs a free seat', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 2 });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: user.id, role: 'viewer' });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'admin',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'admin' });
        expect(await memberRole(ws.id, user.id)).toEqual([{ role: 'admin' }]);
    });

    it('re-inviting an existing viewer as creator in a full workspace → error, role untouched', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 1 });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: user.id, role: 'viewer' });
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'creator',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ error: ACCEPT_NO_SEATS_ERROR });
        expect(await memberRole(ws.id, user.id)).toEqual([{ role: 'viewer' }]);
    });

    it('an existing creator re-invited as admin already holds a seat — accepted even when full', async () => {
        const user = await freshUser();
        const ws = await freshWorkspace({ seats: 2 });
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: user.id, role: 'creator' });
        // used = owner + this creator = 2 = purchased
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: user.email, role: 'admin',
        });

        const res = await post(testApp().app, { token: inv.token },
            await userToken({ sub: user.id, email: user.email }));
        expect(res.json()).toEqual({ workspaceId: ws.id, role: 'admin' });
        expect(await memberRole(ws.id, user.id)).toEqual([{ role: 'admin' }]);
    });
});
