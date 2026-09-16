import { test, expect, type Page } from '@playwright/test';

// Runs signed out so it can seed its own session state.
test.use({ storageState: { cookies: [], origins: [] } });

const USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Seed a returning user whose access token expired an hour ago: Supabase's
 * stored session plus the app's own persisted store, which is what App.tsx
 * gates on.
 */
async function seedExpiredSession(page: Page) {
    await page.addInitScript(({ userId }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify({
            access_token: 'expired.access.token',
            refresh_token: 'stale-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) - 3600,
            user: {
                id: userId, aud: 'authenticated', role: 'authenticated',
                email: 'stale@example.com', app_metadata: {}, user_metadata: {},
                created_at: new Date().toISOString(),
            },
        }));
        localStorage.setItem('recordio-user-storage', JSON.stringify({
            state: {
                userId, email: 'stale@example.com', name: 'Stale User',
                picture: null, pictureSourceUrl: null, isAuthenticated: true,
            },
            version: 0,
        }));
    }, { userId: USER_ID });
}

test('auth server unreachable — explains itself instead of hanging blank', async ({ page }) => {
    await seedExpiredSession(page);
    // Connection refused is what auth-js classes "retryable": it keeps the
    // stale session and emits no event at all.
    await page.route('**/auth/v1/**', route => route.abort('connectionrefused'));
    await page.route('**/localhost:8080/**', route => route.abort('connectionrefused'));

    await page.goto('/');

    // Fast — not after the ~50s of refresh retries
    await expect(page.getByText("Can't reach Recordio")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // Not the sign-in page: signing in wouldn't fix an unreachable server
    await expect(page.getByRole('main', { name: 'Sign in' })).toBeHidden();
});

test('refresh token rejected — sign-in page, not the connection screen', async ({ page }) => {
    await seedExpiredSession(page);
    // The server answered and said no: auth-js drops the session + emits SIGNED_OUT
    await page.route('**/auth/v1/token**', route => route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }),
    }));
    await page.route('**/localhost:8080/**', route => route.abort('connectionrefused'));

    await page.goto('/');

    await expect(page.getByRole('main', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Can't reach Recordio")).toBeHidden();
});

test('401 while the logout call fails — still ends up signed out', async ({ page }) => {
    // A *valid* session, so no refresh is attempted and the app boots normally.
    await page.addInitScript(({ userId }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify({
            access_token: 'valid.access.token',
            refresh_token: 'refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
                id: userId, aud: 'authenticated', role: 'authenticated',
                email: 'stale@example.com', app_metadata: {}, user_metadata: {},
                created_at: new Date().toISOString(),
            },
        }));
        localStorage.setItem('recordio-user-storage', JSON.stringify({
            state: {
                userId, email: 'stale@example.com', name: 'Stale User',
                picture: null, pictureSourceUrl: null, isAuthenticated: true,
            },
            version: 0,
        }));
    }, { userId: USER_ID });

    // Server rejects the token, so the app signs out — but the logout request
    // itself can't get through, which used to mean auth-js emitted no
    // SIGNED_OUT and the UI stayed "signed in" against a wiped session.
    await page.route('**/localhost:8080/**', route => route.fulfill({
        status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }),
    }));
    await page.route('**/auth/v1/**', route => route.abort('connectionrefused'));

    await page.goto('/');

    await expect(page.getByRole('main', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
});
