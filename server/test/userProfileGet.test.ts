/**
 * POST /user-profile-get — Part 2 Batch 4.
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

async function post(app: App, token?: string) {
    return app.inject({
        method: 'POST',
        url: '/user-profile-get',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: {},
    });
}

describe('POST /user-profile-get (auth, no db)', () => {
    it('401 without a token', async () => {
        const app = buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });
        const res = await post(app);
        expect(res.statusCode).toBe(401);
    });
});

describe.runIf(hasTestDb())('POST /user-profile-get (e2e, real Postgres)', () => {
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

    it('returns the profile blob (name + has_reviewed — no trial since revamp Step 2)', async () => {
        const user = await seedAuthUser(pool, { name: 'Profiled Person' });
        createdUsers.push(user.id);

        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ name: 'Profiled Person', has_reviewed: false });
    });

    it('null when no profile row exists', async () => {
        const user = await seedAuthUser(pool, { withProfile: false });
        createdUsers.push(user.id);

        const res = await post(testApp(), await userToken({ sub: user.id, email: user.email }));
        expect(res.statusCode).toBe(200);
        expect(res.body === '' || res.json() === null).toBe(true);
    });
});
