import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// e2e/ is one level below the repo root.
const rootDir = path.resolve(import.meta.dirname, '..');

// Local-stack credentials live in .env.test (committed on purpose — see .gitignore).
// Loading it here lets the auth setup read TEST_USER_* without extra wiring.
loadEnv({ path: path.join(rootDir, '.env.test') });

// Where the logged-in browser session is cached. auth.setup.ts writes it; every
// other test reuses it so tests start already authenticated (no login per test).
export const STORAGE_STATE = path.join(import.meta.dirname, '.auth/user.json');
// The billing specs run as a user of their own (fixtures/testUser.ts BILLING_USER).
export const BILLING_STORAGE_STATE = path.join(import.meta.dirname, '.auth/billing-user.json');

// Defaults match the standard local stack (webapp 3001 → server 8080). Override
// both to point the suite at a second stack without touching the running one:
//   E2E_WEBAPP_PORT=3002 E2E_API_URL=http://localhost:8081 npm run test:e2e
const WEBAPP_PORT = Number(process.env.E2E_WEBAPP_PORT || 3001);
const WEBAPP_URL = `http://localhost:${WEBAPP_PORT}`;

export default defineConfig({
    testDir: './tests',
    outputDir: path.join(import.meta.dirname, 'test-results'),
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: path.join(import.meta.dirname, 'playwright-report') }],
    ],

    use: {
        baseURL: WEBAPP_URL,
        // A scrubbable timeline of the run — open with `npm run test:e2e:report` after a failure.
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        // Logs in once and saves the session. Everything else depends on it.
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
            dependencies: ['setup'],
            testIgnore: /billing\.spec\.ts/,
        },
        // Billing upgrades / resets a workspace's subscription, so it runs as
        // its own user (never the main e2e user's workspace) with its own session.
        { name: 'billing-setup', testMatch: /billing\.setup\.ts/ },
        {
            name: 'billing',
            testMatch: /billing\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], storageState: BILLING_STORAGE_STATE },
            dependencies: ['billing-setup'],
        },
    ],

    // Boots the webapp in dev mode (so the dev login form is available) and waits
    // for it. If you already have `npm run dev:webapp` running, this reuses it.
    // NOTE: this does NOT start Supabase / the Fastify server — see e2e/README.md.
    webServer: {
        command: `npx vite --port ${WEBAPP_PORT}`,
        cwd: path.join(rootDir, 'webapp'),
        url: WEBAPP_URL,
        // E2E_API_URL also steers the webapp's API base (process env beats .env files in Vite)
        env: {
            ...(process.env as Record<string, string>),
            ...(process.env.E2E_API_URL ? { VITE_API_URL: process.env.E2E_API_URL } : {}),
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
