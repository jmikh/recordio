/**
 * Integration test for the real supabaseApi adapter against the local
 * `supabase start` stack (auth admin API). Unlike the third-party adapter
 * tests (S3 against real creds), this needs only the local stack — the same
 * dependency as the e2e tier — so it runs whenever that env is present.
 * Skipped automatically without it.
 */
import { describe, expect, it } from 'vitest';
import { createSupabaseApiAdapter } from '../../src/adapters/supabaseApi.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SEEDED_USER_ID = process.env.TEST_USER_PRO_ID;
const SEEDED_USER_EMAIL = process.env.TEST_USER_PRO_EMAIL;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && SEEDED_USER_ID && SEEDED_USER_EMAIL);

describe.runIf(hasEnv)('supabaseApi adapter (local stack)', () => {
    const adapter = () =>
        createSupabaseApiAdapter({ url: SUPABASE_URL!, serviceRoleKey: SERVICE_ROLE_KEY! });

    it('getUserById returns email and metadata for a seeded user', async () => {
        const user = await adapter().getUserById(SEEDED_USER_ID!);
        expect(user).not.toBeNull();
        expect(user!.email).toBe(SEEDED_USER_EMAIL);
        expect(user!.userMetadata).toBeTypeOf('object');
    });

    it('getUserById returns null for an unknown user', async () => {
        const user = await adapter().getUserById('00000000-0000-0000-0000-000000000000');
        expect(user).toBeNull();
    });
});
