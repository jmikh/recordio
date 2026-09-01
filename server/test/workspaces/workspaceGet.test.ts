/**
 * POST /workspace-get — Part 2 Batch 3.
 * Includes THE live-bug pin: a pending invitation with NULL expires_at
 * APPEARS in the invitations list (the frozen SQL fn's
 * `expires_at > now()` filter excluded every pending invite after the
 * no-expiry migration nulled the column — see suggested_changes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    seedSubscription,
    seedWorkspace,
    seedWorkspaceInvitation,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-get (auth + validation, no db)', () => {
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

describe.runIf(hasTestDb())('POST /workspace-get (e2e, real Postgres)', () => {
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

    it('403 for a non-member', async () => {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);
    });

    it('returns details: caller role, seats, viewer_seats, members (owner synthesized first), and PENDING invitations with NULL expires_at (bug pin)', async () => {
        const ws = await seedWorkspace(pool, { name: 'Details ws' });
        createdWorkspaces.push(ws.id);
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        await seedSubscription(pool, { workspaceId: ws.id, seats: 3 });
        const pending = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: 'Invitee@Example.com', role: 'viewer',
        });
        const accepted = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: 'done@example.com', status: 'accepted',
        });

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(200);

        const body = res.json() as {
            members: Array<Record<string, unknown>>;
            invitations: Array<Record<string, unknown>>;
        } & Record<string, unknown>;
        expect(body).toMatchObject({
            id: ws.id,
            name: 'Details ws',
            owner_id: SEEDED_USER_ID,
            role: 'creator', // the CALLER's role
            seats: 3,
            viewer_seats: 30,
        });

        // Owner leads, synthesized (no workspace_members row since revamp
        // Step 2); member-since = workspace creation
        expect(body.members.map((m) => m.user_id)).toEqual([SEEDED_USER_ID, SEEDED_USER_2_ID]);
        expect(body.members[0]).toMatchObject({ role: 'admin', email: 'user1@gmail.com' });
        expect(body.members[1]).toMatchObject({ role: 'creator', email: 'user2@gmail.com' });

        // The bug pin: the pending invite (expires_at NULL) IS listed
        expect(body.invitations.map((i) => i.id)).toEqual([pending.id]);
        expect(body.invitations[0]).toMatchObject({ email: 'invitee@example.com', role: 'viewer' });
        expect(body.invitations[0]).not.toHaveProperty('expires_at');
        expect(body.invitations.map((i) => i.id)).not.toContain(accepted.id);
    });

    it('null for a deleted workspace is unreachable via the member gate (403 first)', async () => {
        const ws = await seedWorkspace(pool, { deletedAt: new Date().toISOString() });
        createdWorkspaces.push(ws.id);

        const res = await post(testApp(), { workspaceId: ws.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(403); // isWorkspaceMember requires a live workspace, owner included
    });
});
