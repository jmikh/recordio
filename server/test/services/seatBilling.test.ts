/**
 * services/seatBilling.ts — seat pre-purchase model
 * (plans/seat-prepurchase-oneshot.md). getSeatUsage reports purchased
 * (subscriptions.seats), used (owner + creator/admin members) and
 * pending (creator/admin invitations reserve a seat); seatsAvailable is
 * the difference, clamped at 0. Nothing here touches Stripe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getSeatUsage, seatsAvailable } from '../../src/services/seatBilling.js';
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

/** user3 from seed.sql — a third distinct member for count matrices. */
const SEEDED_USER_3_ID = '33333333-3333-3333-3333-333333333333';

describe('seatsAvailable (pure)', () => {
    it.each([
        ['room left', { purchased: 3, used: 1, pending: 0 }, 2],
        ['pending invitations reserve seats', { purchased: 3, used: 2, pending: 1 }, 0],
        ['over capacity clamps at 0 (grandfathered)', { purchased: 2, used: 3, pending: 0 }, 0],
        ['no subscription row', { purchased: null, used: 1, pending: 0 }, 0],
    ])('%s', (_name, usage, expected) => {
        expect(seatsAvailable(usage)).toBe(expected);
    });
});

describe.runIf(hasTestDb())('getSeatUsage (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdWorkspaces: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteWorkspaces(pool, createdWorkspaces);
        await pool.end();
    });

    async function freshWorkspace() {
        const ws = await seedWorkspace(pool);
        createdWorkspaces.push(ws.id);
        return ws;
    }

    it('purchased is null without a subscription row and the seat count with one', async () => {
        const ws = await freshWorkspace();
        expect(await getSeatUsage(pool, ws.id)).toEqual({ purchased: null, used: 1, pending: 0 });

        await seedSubscription(pool, { workspaceId: ws.id, seats: 3 });
        expect(await getSeatUsage(pool, ws.id)).toEqual({ purchased: 3, used: 1, pending: 0 });
    });

    it('used: owner=1, +creator, +admin; viewers free; stale owner row ignored', async () => {
        const ws = await freshWorkspace();
        expect((await getSeatUsage(pool, ws.id)).used).toBe(1); // owner only

        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
        expect((await getSeatUsage(pool, ws.id)).used).toBe(2);

        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_3_ID, role: 'viewer' });
        expect((await getSeatUsage(pool, ws.id)).used).toBe(2); // viewers free

        await pool.query(
            `UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`,
            [ws.id, SEEDED_USER_3_ID],
        );
        expect((await getSeatUsage(pool, ws.id)).used).toBe(3); // admin is a seat

        // Stale pre-Step-2 owner row must never double-count the owner
        await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
        expect((await getSeatUsage(pool, ws.id)).used).toBe(3);
    });

    it('pending: creator/admin invitations only; accepted and viewer rows ignored; excludeInviteEmail drops that one', async () => {
        const ws = await freshWorkspace();
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'c@example.com', role: 'creator' });
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'a@example.com', role: 'admin' });
        await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'v@example.com', role: 'viewer' });
        const done = await seedWorkspaceInvitation(pool, { workspaceId: ws.id, email: 'done@example.com', role: 'creator' });
        await pool.query(`UPDATE workspace_invitations SET status = 'accepted' WHERE id = $1`, [done.id]);

        expect((await getSeatUsage(pool, ws.id)).pending).toBe(2);
        expect((await getSeatUsage(pool, ws.id, { excludeInviteEmail: 'c@example.com' })).pending).toBe(1);
        // Excluding an email without a pending seat invite changes nothing
        expect((await getSeatUsage(pool, ws.id, { excludeInviteEmail: 'v@example.com' })).pending).toBe(2);
    });
});
