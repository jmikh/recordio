import { test as setup } from '@playwright/test';
import { BILLING_STORAGE_STATE } from '../playwright.config';
import { BILLING_USER } from '../fixtures/testUser';
import { devLogin } from '../fixtures/devLogin';

// The billing specs' own account (fixtures/testUser.ts BILLING_USER): created
// on first sign-in by the dev form, with a workspace from the signup bootstrap.
setup('authenticate the billing user via dev login', async ({ page }) => {
    await devLogin(page, BILLING_USER, BILLING_STORAGE_STATE);
});
