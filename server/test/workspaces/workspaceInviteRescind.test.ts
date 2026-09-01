/**
 * POST /workspace-invite-rescind — Part 2 Batch 3.
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
    seedWorkspaceInvitation,
    seedWorkspaceMember,
} from '../helpers/db.js';

async function post(app: App, body: unknown, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-invite-rescind',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: body as Record<string, unknown>,
    });
}

describe('POST /workspace-invite-rescind (auth + validation, no db)', () => {
    function validationApp() {
        return buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
    }

    it('401 without a token', async () => {
        const res = await post(validationApp(), { invitationId: 'x' });
        expect(res.statusCode).toBe(401);
    });

    it('schema 400 pre-query: missing invitationId', async () => {
        const res = await post(validationApp(), {}, await userToken());
        expect(res.statusCode).toBe(400);
    });
});

describe.runIf(hasTestDb())('POST /workspace-invite-rescind (e2e, real Postgres)', () => {
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

    async function adminWorkspaceWithInvite(status: 'pending' | 'accepted' = 'pending') {
        const ws = await seedWorkspace(pool); // owner (implicit admin): SEEDED_USER_ID
        createdWorkspaces.push(ws.id);
        const inv = await seedWorkspaceInvitation(pool, {
            workspaceId: ws.id, email: 'pending@example.com', status,
        });
        return { ws, inv };
    }

    it('404 for an unknown invitation', async () => {
        const res = await post(testApp(), { invitationId: randomUUID() },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Invitation not found or already resolved' });
    });

    it('404 for an already-resolved invitation', async () => {
        const { inv } = await adminWorkspaceWithInvite('accepted');
        const res = await post(testApp(), { invitationId: inv.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(404);
    });

    it('403 for a non-admin; invitation survives', async () => {
        const { ws, inv } = await adminWorkspaceWithInvite();
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'viewer' });

        const res = await post(testApp(), { invitationId: inv.id },
            await userToken({ sub: SEEDED_USER_2_ID }));
        expect(res.statusCode).toBe(403);

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_invitations WHERE id = $1', [inv.id]);
        expect(rows).toHaveLength(1);
    });

    it('deletes the pending invitation for an admin', async () => {
        const { inv } = await adminWorkspaceWithInvite();
        const res = await post(testApp(), { invitationId: inv.id },
            await userToken({ sub: SEEDED_USER_ID }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ invitationId: inv.id });

        const { rows } = await pool.query(
            'SELECT 1 FROM workspace_invitations WHERE id = $1', [inv.id]);
        expect(rows).toEqual([]);
    });
});
