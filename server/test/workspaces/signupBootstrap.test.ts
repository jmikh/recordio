/**
 * Signup bootstrap trigger (revamp Step 2) — inserting an auth.users
 * row fires on_user_signup_bootstrap → user_signup_bootstrap(): the
 * account's one workspace ('My Workspace', trial = created + 7 days,
 * extension count 0) plus the profile pointing at it as the default.
 * No workspace_members row — owner is its own state. Deleting the auth
 * user cascades the workspace (FK added by migration 20260901131117).
 *
 * Pure-DB suite (no routes): pins the trigger + cascade behavior every
 * e2e suite implicitly depends on via seedAuthUser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
    createTestPool,
    deleteAuthUsers,
    hasTestDb,
    seedAuthUser,
} from '../helpers/db.js';

describe.runIf(hasTestDb())('signup bootstrap trigger (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteAuthUsers(pool, createdUsers);
        await pool.end();
    });

    it('creates the owned workspace + profile, no member row, 7-day trial', async () => {
        const user = await seedAuthUser(pool, { keepBootstrapWorkspace: true });
        createdUsers.push(user.id);

        const { rows: wsRows } = await pool.query(
            `SELECT id, name, trial_extension_count,
                    round(extract(epoch FROM trial_ends_at - created_at) / 86400) AS trial_days
             FROM workspaces WHERE owner_id = $1`,
            [user.id],
        );
        expect(wsRows).toHaveLength(1);
        const ws = wsRows[0] as { id: string; name: string; trial_extension_count: number; trial_days: string };
        expect(ws.name).toBe('My Workspace');
        expect(Number(ws.trial_days)).toBe(7);
        expect(ws.trial_extension_count).toBe(0);

        const { rows: memberRows } = await pool.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1',
            [ws.id],
        );
        expect(memberRows).toHaveLength(0);

        const { rows: profileRows } = await pool.query(
            'SELECT default_workspace_id FROM user_profiles WHERE user_id = $1',
            [user.id],
        );
        expect(profileRows).toHaveLength(1);
        expect((profileRows[0] as { default_workspace_id: string }).default_workspace_id).toBe(ws.id);
    });

    it('deleting the auth user cascades the owned workspace', async () => {
        const user = await seedAuthUser(pool, { keepBootstrapWorkspace: true });

        await pool.query('DELETE FROM user_profiles WHERE user_id = $1', [user.id]);
        await pool.query('DELETE FROM auth.users WHERE id = $1', [user.id]);

        const { rows } = await pool.query(
            'SELECT 1 FROM workspaces WHERE owner_id = $1',
            [user.id],
        );
        expect(rows).toHaveLength(0);
    });
});
