/**
 * Contract test against a REAL Supabase-issued token: requires the local
 * stack (`supabase start`) and the root `.env.test` (loaded by the root
 * vitest config). Skipped automatically when that env is absent (e.g. CI).
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_USER_PRO_EMAIL;
const PASSWORD = process.env.TEST_USER_PRO_PASSWORD;
const USER_ID = process.env.TEST_USER_PRO_ID;

/** The well-known local-stack default; override for a non-default local setup */
const JWT_SECRET =
    process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

const hasEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && EMAIL && PASSWORD && USER_ID);

function testApp(): App {
    // Both verification paths, as in production: HS256 secret + JWKS URL.
    // Current local-stack tokens are ES256, so this exercises the JWKS path.
    const app = buildApp(createFakeDeps(), {
        supabaseJwtSecret: JWT_SECRET,
        supabaseUrl: SUPABASE_URL,
        logLevel: 'silent',
    });
    app.register(async (instance) => {
        instance.get('/protected', { preHandler: instance.requireUser }, async (req) => ({
            userId: req.user!.id,
            email: req.user!.email,
        }));
    });
    return app;
}

describe.runIf(hasEnv)('auth contract (real local Supabase token)', () => {
    it('accepts a token issued by Supabase auth', async () => {
        const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: EMAIL!,
            password: PASSWORD!,
        });
        expect(error).toBeNull();

        const res = await testApp().inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${data.session!.access_token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ userId: USER_ID, email: EMAIL });
    });

    it('rejects the anon key itself', async () => {
        const res = await testApp().inject({
            method: 'GET',
            url: '/protected',
            headers: { authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        expect(res.statusCode).toBe(401);
    });
});
