import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load .env.test
config({ path: '.env.test' });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Admin client — bypasses RLS. Use for test setup/teardown only. */
export const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Create an authenticated client for a test user. */
export async function createAuthenticatedClient(
    email: string,
    password: string,
): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Auth failed for ${email}: ${error.message}`);
    return client;
}

/** Pre-configured clients for the two seed users. */
export async function getProClient() {
    return createAuthenticatedClient(
        process.env.TEST_USER_PRO_EMAIL!,
        process.env.TEST_USER_PRO_PASSWORD!,
    );
}

export async function getTrialClient() {
    return createAuthenticatedClient(
        process.env.TEST_USER_TRIAL_EMAIL!,
        process.env.TEST_USER_TRIAL_PASSWORD!,
    );
}

export const TEST_IDS = {
    proUserId: process.env.TEST_USER_PRO_ID!,
    trialUserId: process.env.TEST_USER_TRIAL_ID!,
    minimalProjectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    fullProjectId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    trialProjectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};
