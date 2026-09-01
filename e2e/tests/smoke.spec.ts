import { test, expect } from '@playwright/test';

// These tests run authenticated: the chromium project loads the session saved by
// auth.setup.ts, so page.goto('/') lands past the sign-in gate.
test.describe('smoke (authenticated)', () => {
    test('lands on the dashboard', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByPlaceholder('Search recordings, transcripts...')).toBeVisible();
        await expect(page.getByText('Sign in to keep recording')).toBeHidden();
    });

    test('can open workspace settings → Plans & Billing', async ({ page }) => {
        await page.goto('/workspace/settings/billing');
        await expect(page.getByText('Plans & Billing').first()).toBeVisible();
        await expect(page.getByText('Sign in to keep recording')).toBeHidden();
    });
});
