import { test, expect } from '@playwright/test';

// This test must run WITHOUT the saved session, so it overrides storageState to
// an empty one. It verifies the auth gate itself: an unauthenticated visitor to a
// protected route is shown the sign-in modal.
test.use({ storageState: { cookies: [], origins: [] } });

test('unauthenticated visitor is shown the sign-in modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
});

test('the dashboard never renders behind the sign-in modal', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await expect(dialog).toBeVisible();

    // Nothing but the page background is underneath
    await expect(page.getByPlaceholder('Search recordings, transcripts...')).toBeHidden();

    // …and the modal has no way out: clicking the backdrop leaves it up
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
});
