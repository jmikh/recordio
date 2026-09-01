import { test as setup, expect } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import { TEST_USER } from '../fixtures/testUser';

// The dev login form auto-creates the account on first sign-in, so a missing
// user is fine. Creds resolve in fixtures/testUser.ts (.env.test + E2E_* overrides).
const EMAIL = TEST_USER.email;
const PASSWORD = TEST_USER.password;

setup('authenticate via dev login', async ({ page }) => {
    // Unauthenticated users hit the sign-in modal on any protected route.
    await page.goto('/');

    const email = page.getByLabel('Email');
    await expect(
        email,
        'Dev login form not found — is the webapp running in dev mode (npm run dev:webapp) and Supabase up?',
    ).toBeVisible();

    await email.fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in \/ create account/i }).click();

    // Success = the modal is gone and the dashboard chrome has rendered.
    await expect(page.getByText('Sign in to keep recording')).toBeHidden();
    await expect(page.getByPlaceholder('Search recordings, transcripts...')).toBeVisible();

    // Persist cookies + localStorage (Supabase session) for reuse by other tests.
    await page.context().storageState({ path: STORAGE_STATE });
});
