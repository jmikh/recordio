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
        baseURL: 'http://localhost:3001',
        // A scrubbable timeline of the run — open with `npm run test:e2e:report` after a failure.
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        // Logs in once and saves the session. Everything else depends on it.
        { name: 'setup', testMatch: /.*\.setup\.ts/ },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
            dependencies: ['setup'],
        },
    ],

    // Boots the webapp in dev mode (so the dev login form is available) and waits
    // for it. If you already have `npm run dev:webapp` running, this reuses it.
    // NOTE: this does NOT start Supabase / the Fastify server — see e2e/README.md.
    webServer: {
        command: 'npm run dev:webapp',
        cwd: rootDir,
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
