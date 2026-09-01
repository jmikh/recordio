/**
 * POST /user-review-set — marks the caller as having left a CWS review
 * (LeaveReviewModal persistence). Idempotent: the first timestamp wins.
 * Dedicated auth users: profile rows of the seeded users are contested
 * shared state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET, userToken } from './helpers/tokens.js';
import {
    createTestPool,
    deleteAuthUsers,
    hasTestDb,
    seedAuthUser,
} from './helpers/db.js';

async function post(app: App, url: string, token?: string) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: {},
    });
}

describe('POST /user-review-set (auth, no db)', () => {
    it('401 without a token', async () => {
        const app = buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app, '/user-review-set');
        expect(res.statusCode).toBe(401);
    });
});

describe.runIf(hasTestDb())('POST /user-review-set (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterAll(async () => {
        await deleteAuthUsers(pool, createdUsers);
        await pool.end();
    });

    function testApp() {
        return buildApp(createFakeDeps({ db: pool }), {
            supabaseJwtSecret: TEST_JWT_SECRET,
            logLevel: 'silent',
        });
    }

    async function reviewedAt(userId: string): Promise<Date | null> {
        const { rows } = await pool.query(
            'SELECT reviewed_at FROM user_profiles WHERE user_id = $1', [userId]);
        return (rows[0] as { reviewed_at: Date | null } | undefined)?.reviewed_at ?? null;
    }

    it('sets reviewed_at (fakeClock now) and the profile blob flips has_reviewed', async () => {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        const token = await userToken({ sub: user.id, email: user.email });
        const app = testApp();

        const res = await post(app, '/user-review-set', token);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ hasReviewed: true });
        expect(await reviewedAt(user.id)).not.toBeNull();

        const profile = await post(app, '/user-profile-get', token);
        expect(profile.json()).toMatchObject({ has_reviewed: true });
    });

    it('idempotent: a second call keeps the FIRST timestamp', async () => {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        const token = await userToken({ sub: user.id, email: user.email });
        const app = testApp();

        await post(app, '/user-review-set', token);
        const first = await reviewedAt(user.id);

        const res = await post(app, '/user-review-set', token);
        expect(res.statusCode).toBe(200);
        expect((await reviewedAt(user.id))!.getTime()).toBe(first!.getTime());
    });

    it('creates the profile row when the signup trigger left none', async () => {
        const user = await seedAuthUser(pool, { withProfile: false });
        createdUsers.push(user.id);

        const res = await post(testApp(), '/user-review-set',
            await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(await reviewedAt(user.id)).not.toBeNull();
    });
});
