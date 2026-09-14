import { expect, type Page } from '@playwright/test';
import type { E2eCredentials } from './testUser';

/**
 * Sign in through the dev login form and persist the session. The form
 * auto-creates the account on first sign-in, so a missing user is fine.
 * Shared with billing.setup.ts, which does the same for the billing user.
 */
export async function devLogin(page: Page, user: E2eCredentials, storageStatePath: string) {
    // Unauthenticated users hit the sign-in modal on any protected route.
    await page.goto('/');

    const email = page.getByLabel('Email');
    await expect(
        email,
        'Dev login form not found — is the webapp running in dev mode (npm run dev:webapp) and Supabase up?',
    ).toBeVisible();

    await email.fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: /sign in \/ create account/i }).click();

    // Success = the modal is gone and the dashboard chrome has rendered.
    await expect(page.getByText('Sign in to keep recording')).toBeHidden();
    await expect(page.getByPlaceholder('Search recordings, transcripts...')).toBeVisible();

    // Persist cookies + localStorage (Supabase session) for reuse by other tests.
    await page.context().storageState({ path: storageStatePath });
}

