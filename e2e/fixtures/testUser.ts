// Single source of truth for the e2e user + local endpoints. Values come from
// .env.test (loaded by playwright.config.ts) with E2E_* overrides.
export const TEST_USER = {
    email: process.env.E2E_USER_EMAIL || process.env.TEST_USER_PRO_EMAIL || 'user1@gmail.com',
    password: process.env.E2E_USER_PASSWORD || process.env.TEST_USER_PRO_PASSWORD || 'password123',
};

export const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// The Fastify server (see START_LOCALLY.md) — where project/workspace APIs live.
export const API_URL = process.env.E2E_API_URL || 'http://localhost:8080';
