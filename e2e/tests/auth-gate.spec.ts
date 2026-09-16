import { test, expect } from '@playwright/test';

// This test must run WITHOUT the saved session, so it overrides storageState to
// an empty one. It verifies the auth gate itself: an unauthenticated visitor to a
// protected route is shown the sign-in page.
test.use({ storageState: { cookies: [], origins: [] } });

test('unauthenticated visitor is shown the sign-in page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
});

test('the dashboard never renders behind the sign-in page', async ({ page }) => {
    await page.goto('/');
    const signIn = page.getByRole('main', { name: 'Sign in' });
    await expect(signIn).toBeVisible();

    // The gate replaces the app: no dashboard underneath
    await expect(page.getByPlaceholder('Search recordings, transcripts...')).toBeHidden();

    // …and there's no way past it: clicking around leaves it up
    await page.mouse.click(5, 5);
    await expect(signIn).toBeVisible();
});
