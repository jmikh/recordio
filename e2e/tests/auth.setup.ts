import { test as setup } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import { devLogin } from '../fixtures/devLogin';
import { TEST_USER } from '../fixtures/testUser';

// Creds resolve in fixtures/testUser.ts (.env.test + E2E_* overrides).
setup('authenticate via dev login', async ({ page }) => {
    await devLogin(page, TEST_USER, STORAGE_STATE);
});
