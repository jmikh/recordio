/**
 * services/seatBilling.ts — revamp Step 6. The billed quantity is
 * DERIVED state: computeBilledSeats = 1 (owner) + creator/admin member
 * rows; syncSeatQuantity SETS Stripe to that number (never increments),
 * no-ops when nothing changed or nothing is syncable, and never throws
 * (membership changes must not fail on billing).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { computeBilledSeats, syncSeatQuantity } from '../../src/services/seatBilling.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import {
    createTestPool,
    deleteWorkspaces,
    hasTestDb,
    SEEDED_USER_2_ID,
    SEEDED_USER_ID,
    seedSubscription,
    seedWorkspace,
    seedWorkspaceMember,
} from '../helpers/db.js';

const silentLog = { info() {}, warn() {}, error() {} };

/** user3 from seed.sql — a third distinct member for count matrices. */
const SEEDED_USER_3_ID = '33333333-3333-3333-3333-333333333333';

describe.runIf(hasTestDb())('seatBilling (e2e, real Postgres)', () => {
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

    function fakeDeps() {
        return createFakeDeps({ db: pool }) as FakeDeps;
    }

    function seedFakeSub(deps: FakeDeps, id: string, quantity: number) {
        deps.stripe.subscriptions.set(id, {
            id,
            status: 'active',
            customer: 'cus_seatbilling',
            items: {
                data: [{
                    id: 'si_seat_1',
                    quantity,
                    current_period_end: 1800000000,
                    price: { id: 'price_m', unit_amount: 1500, recurring: { interval: 'month' } },
                }],
            },
        });
    }

    describe('computeBilledSeats', () => {
        it('matrix: owner=1, +creator, +admin; viewers free; stale owner row ignored', async () => {
            const ws = await freshWorkspace();
            expect(await computeBilledSeats(pool, ws.id)).toBe(1); // owner only

            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            expect(await computeBilledSeats(pool, ws.id)).toBe(2);

            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_3_ID, role: 'viewer' });
            expect(await computeBilledSeats(pool, ws.id)).toBe(2); // viewers free

            await pool.query(
                `UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`,
                [ws.id, SEEDED_USER_3_ID],
            );
            expect(await computeBilledSeats(pool, ws.id)).toBe(3); // admin is a seat

            // Stale pre-Step-2 owner row must never double-count the owner
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_ID, role: 'admin' });
            expect(await computeBilledSeats(pool, ws.id)).toBe(3);
        });
    });

    describe('syncSeatQuantity', () => {
        const change = { kind: 'joined' as const, memberEmail: 'new@example.com', role: 'creator' };

        it('SETS the quantity to the computed count (never increments), writes DB seats, emails the owner', async () => {
            const ws = await freshWorkspace();
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            const subId = `sub_seat_${randomUUID().slice(0, 8)}`;
            await seedSubscription(pool, { workspaceId: ws.id, stripeSubscriptionId: subId, seats: 5 });

            const deps = fakeDeps();
            seedFakeSub(deps, subId, 5); // drifted: Stripe says 5, computed is 2
            await syncSeatQuantity(deps, ws.id, change, silentLog);

            expect(deps.stripe.subscriptionUpdates).toEqual([{
                id: subId,
                params: {
                    items: [{ id: 'si_seat_1', quantity: 2 }],
                    proration_behavior: 'always_invoice',
                },
            }]);
            const { rows } = await pool.query(
                'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
            expect(rows).toEqual([{ seats: 2 }]);

            expect(deps.email.sent).toHaveLength(1);
            expect(deps.email.sent[0].to).toBe('user1@gmail.com');
            expect(deps.email.sent[0].subject).toBe(
                'new@example.com joined Test workspace — your plan is now 2 seats');
            expect(deps.email.sent[0].html).toContain('$30/month');
        });

        it('no-op when the live quantity already matches: no update, no email', async () => {
            const ws = await freshWorkspace();
            const subId = `sub_seat_${randomUUID().slice(0, 8)}`;
            await seedSubscription(pool, { workspaceId: ws.id, stripeSubscriptionId: subId });

            const deps = fakeDeps();
            seedFakeSub(deps, subId, 1); // owner only → computed 1 === live 1
            await syncSeatQuantity(deps, ws.id, change, silentLog);

            expect(deps.stripe.subscriptionUpdates).toEqual([]);
            expect(deps.email.sent).toEqual([]);
        });

        it.each([
            ['no subscription row', async (_ws: string) => {}],
            ['canceled subscription', async (ws: string) =>
                seedSubscription(pool, { workspaceId: ws, status: 'canceled' })],
            ['no Stripe link', async (ws: string) =>
                seedSubscription(pool, { workspaceId: ws, stripeSubscriptionId: null })],
        ])('no-op on %s', async (_name, seed) => {
            const ws = await freshWorkspace();
            await seed(ws.id);

            const deps = fakeDeps();
            await syncSeatQuantity(deps, ws.id, change, silentLog);
            expect(deps.stripe.subscriptionUpdates).toEqual([]);
        });

        it('never throws: Stripe failure resolves quietly, DB seats untouched', async () => {
            const ws = await freshWorkspace();
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'creator' });
            await seedSubscription(pool, { workspaceId: ws.id, seats: 1 }); // random sub id, NOT in fake map

            const deps = fakeDeps();
            await expect(
                syncSeatQuantity(deps, ws.id, change, silentLog),
            ).resolves.toBeUndefined();

            const { rows } = await pool.query(
                'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
            expect(rows).toEqual([{ seats: 1 }]);
            expect(deps.email.sent).toEqual([]);
        });

        it('an email failure never fails the sync; DB write already landed', async () => {
            const ws = await freshWorkspace();
            await seedWorkspaceMember(pool, { workspaceId: ws.id, userId: SEEDED_USER_2_ID, role: 'admin' });
            const subId = `sub_seat_${randomUUID().slice(0, 8)}`;
            await seedSubscription(pool, { workspaceId: ws.id, stripeSubscriptionId: subId });

            const deps = fakeDeps();
            seedFakeSub(deps, subId, 1);
            deps.email.nextResult = { success: false, error: 'resend down' };

            await expect(
                syncSeatQuantity(deps, ws.id, change, silentLog),
            ).resolves.toBeUndefined();

            const { rows } = await pool.query(
                'SELECT seats FROM subscriptions WHERE workspace_id = $1', [ws.id]);
            expect(rows).toEqual([{ seats: 2 }]);
        });

        it('removal direction: credit copy in the email (decreased quantity)', async () => {
            const ws = await freshWorkspace();
            const subId = `sub_seat_${randomUUID().slice(0, 8)}`;
            await seedSubscription(pool, { workspaceId: ws.id, stripeSubscriptionId: subId, seats: 2 });

            const deps = fakeDeps();
            seedFakeSub(deps, subId, 2); // member already deleted → computed 1
            await syncSeatQuantity(deps, ws.id, {
                kind: 'removed', memberEmail: 'gone@example.com', memberName: 'Gone Person', role: 'creator',
            }, silentLog);

            expect(deps.stripe.subscriptionUpdates[0].params).toMatchObject({
                items: [{ id: 'si_seat_1', quantity: 1 }],
            });
            expect(deps.email.sent[0].subject).toBe(
                'Gone Person was removed from Test workspace — your plan is now 1 seat');
            expect(deps.email.sent[0].html).toContain('prorated credit');
        });
    });
});
