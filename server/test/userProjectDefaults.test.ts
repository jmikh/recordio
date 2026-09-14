/**
 * POST /user-project-defaults-get / -set / -clear — personal default
 * project settings (plans/user-default-project-settings). Dedicated
 * auth users: profile rows of the seeded users are contested shared
 * state. The get route deliberately has no response schema (arbitrary
 * jsonb blob), so the round-trip test pins that nothing is stripped.
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
import { USER_PROJECT_DEFAULTS_BODY_LIMIT } from '../src/routes/userProjectDefaultsSet.js';

const SAMPLE_DEFAULTS = {
    schemaVersion: 6,
    settings: {
        outputSize: { width: 1080, height: 1920 },
        frameRate: 60,
        background: {
            type: 'color',
            colorMode: 'solid',
            color: '#112233ff',
            gradientColors: ['#000000ff', '#ffffffff'],
            gradientDirection: 90,
            backgroundBlurPx: 0,
            // an unknown-to-the-server key must survive (additionalProperties)
            storagePath: 'user/abc/background.png',
        },
        camera: { shape: 'square', widthPx: 240, heightPx: 240, xPx: 10, yPx: 10 },
        keyboard: { showHotkeys: false, hotkeysSize: 1, hotkeysPlacement: 'top', hotkeysMargin: 4 },
    },
};

async function post(app: App, url: string, token?: string, payload: unknown = {}) {
    return app.inject({
        method: 'POST',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('user-project-defaults routes (auth, no db)', () => {
    const app = () => buildApp(createFakeDeps(), { supabaseJwtSecret: TEST_JWT_SECRET, logLevel: 'silent' });

    it('401 without a token on all three routes', async () => {
        expect((await post(app(), '/user-project-defaults-get')).statusCode).toBe(401);
        expect((await post(app(), '/user-project-defaults-set', undefined, SAMPLE_DEFAULTS)).statusCode).toBe(401);
        expect((await post(app(), '/user-project-defaults-clear')).statusCode).toBe(401);
    });

    it('set: 400 on a malformed body (schemaVersion below 1, non-object settings, missing settings)', async () => {
        const token = await userToken({ sub: '00000000-0000-4000-8000-000000000001', email: 'x@example.com' });
        const bad = [
            { schemaVersion: 0, settings: {} },
            { schemaVersion: 6, settings: 'nope' },
            { schemaVersion: 6 },
            { settings: {} },
        ];
        for (const body of bad) {
            const res = await post(app(), '/user-project-defaults-set', token, body);
            expect(res.statusCode, JSON.stringify(body)).toBe(400);
        }
    });

    it('set: 413 when the body exceeds the route body limit', async () => {
        const token = await userToken({ sub: '00000000-0000-4000-8000-000000000002', email: 'y@example.com' });
        const body = { schemaVersion: 6, settings: { pad: 'x'.repeat(USER_PROJECT_DEFAULTS_BODY_LIMIT + 1024) } };
        const res = await post(app(), '/user-project-defaults-set', token, body);
        expect(res.statusCode).toBe(413);
    });
});

describe.runIf(hasTestDb())('user-project-defaults routes (e2e, real Postgres)', () => {
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

    async function storedDefaults(userId: string): Promise<unknown> {
        const { rows } = await pool.query(
            'SELECT project_defaults FROM user_profiles WHERE user_id = $1', [userId]);
        return (rows[0] as { project_defaults: unknown } | undefined)?.project_defaults ?? null;
    }

    async function newUser(opts?: { withProfile?: boolean }) {
        const user = await seedAuthUser(pool, opts);
        createdUsers.push(user.id);
        const token = await userToken({ sub: user.id, email: user.email });
        return { user, token };
    }

    it('get: null for a fresh user — nothing is ever seeded', async () => {
        const { user, token } = await newUser();
        const res = await post(testApp(), '/user-project-defaults-get', token);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toBeNull();
        expect(await storedDefaults(user.id)).toBeNull();
    });

    it('set → get round-trips the exact blob, unknown keys included; a second set replaces', async () => {
        const { user, token } = await newUser();
        const app = testApp();

        const set = await post(app, '/user-project-defaults-set', token, SAMPLE_DEFAULTS);
        expect(set.statusCode).toBe(200);
        expect(set.json()).toEqual({ saved: true });

        const get = await post(app, '/user-project-defaults-get', token);
        expect(get.statusCode).toBe(200);
        expect(get.json()).toEqual(SAMPLE_DEFAULTS);
        expect(await storedDefaults(user.id)).toEqual(SAMPLE_DEFAULTS);

        const replacement = { schemaVersion: 7, settings: { frameRate: 30 } };
        await post(app, '/user-project-defaults-set', token, replacement);
        expect((await post(app, '/user-project-defaults-get', token)).json()).toEqual(replacement);
    });

    it('set is scoped to the caller — another user still reads null', async () => {
        const a = await newUser();
        const b = await newUser();
        const app = testApp();
        await post(app, '/user-project-defaults-set', a.token, SAMPLE_DEFAULTS);
        expect((await post(app, '/user-project-defaults-get', b.token)).json()).toBeNull();
    });

    it('clear → get null; clearing with nothing stored is still 200', async () => {
        const { user, token } = await newUser();
        const app = testApp();

        const first = await post(app, '/user-project-defaults-clear', token);
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ cleared: true });

        await post(app, '/user-project-defaults-set', token, SAMPLE_DEFAULTS);
        expect(await storedDefaults(user.id)).not.toBeNull();

        const res = await post(app, '/user-project-defaults-clear', token);
        expect(res.statusCode).toBe(200);
        expect((await post(app, '/user-project-defaults-get', token)).json()).toBeNull();
        expect(await storedDefaults(user.id)).toBeNull();
    });

    it('set creates the profile row when the signup trigger left none', async () => {
        const { user, token } = await newUser({ withProfile: false });
        const res = await post(testApp(), '/user-project-defaults-set', token, SAMPLE_DEFAULTS);
        expect(res.statusCode).toBe(200);
        expect(await storedDefaults(user.id)).toEqual(SAMPLE_DEFAULTS);
    });

    it('does not leak into /user-profile-get', async () => {
        const { token } = await newUser();
        const app = testApp();
        await post(app, '/user-project-defaults-set', token, SAMPLE_DEFAULTS);
        const profile = await post(app, '/user-profile-get', token);
        expect(profile.json()).not.toHaveProperty('project_defaults');
    });
});
