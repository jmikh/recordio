/**
 * POST /workspace-list — Part 2 Batch 3.
 * Dedicated auth user so the list is fully owned by this suite → exact
 * array assertions are safe. Ordering pin: oldest-first BY COLUMN (the
 * switcher shows the original workspace first; the SQL fn text-compared
 * the rendered timestamp).
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

async function post(app: App, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/workspace-list',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: {},
    });
}

describe('POST /workspace-list (auth, no db)', () => {
    it('401 without a token', async () => {
        const app = buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app);
        expect(res.statusCode).toBe(401);
    });
});

describe.runIf(hasTestDb())('POST /workspace-list (e2e, real Postgres)', () => {
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

    it('lists only live memberships, oldest-first, with role and subscription seats', async () => {
        const older = await seedWorkspace(pool, { ownerId: user.id, name: 'Older' });
        const newer = await seedWorkspace(pool, { name: 'Newer' }); // joined, not owned
        const deleted = await seedWorkspace(pool, { ownerId: user.id, deletedAt: new Date().toISOString() });
        const notMine = await seedWorkspace(pool); // no membership
        createdWorkspaces.push(older.id, newer.id, deleted.id, notMine.id);
        await pool.query(
            `UPDATE workspaces SET created_at = now() - interval '1 day' WHERE id = $1`,
            [older.id],
        );
        await seedWorkspaceMember(pool, { workspaceId: older.id, userId: user.id, role: 'admin' });
        await seedWorkspaceMember(pool, { workspaceId: newer.id, userId: user.id, role: 'viewer' });
        await seedWorkspaceMember(pool, { workspaceId: deleted.id, userId: user.id });
        await seedSubscription(pool, { workspaceId: newer.id, plan: 'teams', seats: 7 });

        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);

        const { workspaces } = res.json() as { workspaces: Array<Record<string, unknown>> };
        expect(workspaces.map((w) => w.id)).toEqual([older.id, newer.id]);
        expect(workspaces[0]).toMatchObject({ name: 'Older', role: 'admin', seats: null });
        expect(workspaces[1]).toMatchObject({ name: 'Newer', role: 'viewer', seats: 7 });
    });

    it('empty list for a user with no memberships', async () => {
        const loner = await seedAuthUser(pool);
        const res = await post(testApp(), await userToken({ sub: loner.id, email: loner.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ workspaces: [] });
        await deleteAuthUsers(pool, [loner.id]);
    });
});
