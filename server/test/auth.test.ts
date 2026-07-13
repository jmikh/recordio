import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp, type App } from '../src/app.js';
import { requireServiceBearer } from '../src/plugins/auth.js';
import { createFakeDeps } from './fakes/index.js';

const TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters';
const WRONG_SECRET = 'wrong-jwt-secret-with-at-least-32-characters';

function signToken(payload: Record<string, unknown>, secret = TEST_SECRET, expSeconds = 3600) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
        .sign(new TextEncoder().encode(secret));
}

function userToken(overrides: Record<string, unknown> = {}, secret = TEST_SECRET) {
    return signToken(
        {
            sub: 'user-1',
            role: 'authenticated',
            email: 'user@example.com',
            user_metadata: { full_name: 'Test User' },
            ...overrides,
        },
        secret,
    );
}

function testApp(): App {
    const app = buildApp(createFakeDeps(), {
        supabaseJwtSecret: TEST_SECRET,
        logLevel: 'silent',
    });
    // Routes consume decorators inside a plugin, same as real route modules
    app.register(async (instance) => {
        instance.get('/protected', { preHandler: instance.requireUser }, async (req) => ({
            userId: req.user!.id,
            email: req.user!.email,
        }));
        instance.post('/service', { preHandler: requireServiceBearer('render-secret') }, async () => ({
            ok: true,
        }));
    });
    return app;
}

async function getProtected(app: App, authorization?: string) {
    return app.inject({
        method: 'GET',
        url: '/protected',
        headers: authorization ? { authorization } : {},
    });
}

describe('requireUser', () => {
    it('accepts a valid user token and attaches the user', async () => {
        const res = await getProtected(testApp(), `Bearer ${await userToken()}`);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ userId: 'user-1', email: 'user@example.com' });
    });

    it('401 without an Authorization header', async () => {
        const res = await getProtected(testApp());
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 for garbage tokens', async () => {
        const res = await getProtected(testApp(), 'Bearer not-a-jwt');
        expect(res.statusCode).toBe(401);
    });

    it('401 for a token signed with the wrong secret', async () => {
        const res = await getProtected(testApp(), `Bearer ${await userToken({}, WRONG_SECRET)}`);
        expect(res.statusCode).toBe(401);
    });

    it('401 for an expired token', async () => {
        const expired = await signToken(
            { sub: 'user-1', role: 'authenticated' },
            TEST_SECRET,
            -60,
        );
        const res = await getProtected(testApp(), `Bearer ${expired}`);
        expect(res.statusCode).toBe(401);
    });

    it('401 for anon-role tokens signed with the same secret (anon key shape)', async () => {
        const anonKey = await signToken({ role: 'anon', iss: 'supabase' });
        const res = await getProtected(testApp(), `Bearer ${anonKey}`);
        expect(res.statusCode).toBe(401);
    });

    it('fails closed when no JWT secret or URL is configured', async () => {
        const app = buildApp(createFakeDeps(), { logLevel: 'silent' });
        app.register(async (instance) => {
            instance.get('/protected', { preHandler: instance.requireUser }, async () => ({ ok: true }));
        });
        const res = await getProtected(app, `Bearer ${await userToken()}`);
        expect(res.statusCode).toBe(500);
    });
});

describe('requireServiceBearer', () => {
    it('accepts the exact secret', async () => {
        const res = await testApp().inject({
            method: 'POST',
            url: '/service',
            headers: { authorization: 'Bearer render-secret' },
        });
        expect(res.statusCode).toBe(200);
    });

    it('401 for wrong or missing secrets', async () => {
        const app = testApp();
        const wrong = await app.inject({
            method: 'POST',
            url: '/service',
            headers: { authorization: 'Bearer nope' },
        });
        const missing = await app.inject({ method: 'POST', url: '/service' });
        expect(wrong.statusCode).toBe(401);
        expect(missing.statusCode).toBe(401);
    });
});
