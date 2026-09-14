import { test, expect, type Page } from '@playwright/test';

/**
 * Personal Settings — the user's default project settings
 * (plans/user-default-project-settings). Runs authenticated (see
 * auth.setup.ts) against the local stack: webapp + Fastify server +
 * Supabase. The round-trip test writes and then clears the test user's
 * defaults, so it leaves the account as it found it (NULL).
 */

const PROJECT_SAVE_ROUTES = ['/project-update', '/project-create-v2'];

/** Fails the test if the defaults page ever tries to save a *project*. */
function watchForProjectSaves(page: Page) {
    const offenders: string[] = [];
    page.on('request', req => {
        if (PROJECT_SAVE_ROUTES.some(r => req.url().includes(r))) offenders.push(req.url());
    });
    return offenders;
}

test.describe('personal settings (authenticated)', () => {
    test('opens from the sidebar with a preview and nothing to save', async ({ page }) => {
        const saves = watchForProjectSaves(page);

        await page.goto('/');
        await page.getByRole('button', { name: 'Personal Settings' }).click();
        await expect(page).toHaveURL(/\/settings\/personal$/);

        await expect(page.getByRole('heading', { name: 'Personal settings' })).toBeVisible();
        await expect(page.getByText('Loading defaults…')).toBeHidden();
        await expect(page.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
        await expect(page.getByLabel('Preview of your default settings on a sample recording')).toBeVisible();
        await expect(page.getByText('Sample media unavailable')).toBeHidden();

        // The editor's settings tabs minus Audio, plus Motion (scoped to the nav —
        // the panel's collapsible card headers repeat the same names)
        const nav = page.locator('#defaults-settings-nav');
        for (const tab of ['Background', 'Screen', 'Effects', 'Camera', 'Captions', 'Motion']) {
            await expect(nav.getByRole('button', { name: tab, exact: true })).toBeVisible();
        }
        await expect(nav.getByRole('button', { name: 'Audio', exact: true })).toHaveCount(0);
        // No per-recording / editor-only controls on the defaults page
        await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Default aspect ratio' })).toHaveCount(0);

        // Effect previews play on the canvas and the still comes back
        await nav.getByRole('button', { name: 'Effects', exact: true }).click();
        await expect(page.getByRole('switch', { name: 'Drag Effect' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Preview click effect', exact: true }).click();
        await expect(page.getByText('Playing click effect')).toBeVisible();
        await expect(page.getByText('Playing click effect')).toBeHidden({ timeout: 5000 });
        await nav.getByRole('button', { name: 'Motion', exact: true }).click();
        await page.getByRole('button', { name: 'Preview auto-zoom', exact: true }).click();
        await expect(page.getByText('Playing auto-zoom')).toBeVisible();
        await expect(page.getByText('Playing auto-zoom')).toBeHidden({ timeout: 8000 });
        await nav.getByRole('button', { name: 'Camera', exact: true }).click();
        await expect(page.getByRole('switch', { name: 'Mirror' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Preview auto shrink', exact: true }).click();
        await expect(page.getByText('Playing auto shrink')).toBeVisible();
        await expect(page.getByText('Playing auto shrink')).toBeHidden({ timeout: 8000 });

        expect(saves, 'the defaults page must never save a project').toEqual([]);
    });

    test('edit → save → reload → reset round-trip', async ({ page }, testInfo) => {
        const saves = watchForProjectSaves(page);
        await page.goto('/settings/personal');
        await expect(page.getByText('Loading defaults…')).toBeHidden();

        // Start clean whatever an earlier run left behind
        const reset = page.getByRole('button', { name: 'Reset to Recordio defaults' });
        if (await reset.isEnabled()) {
            await reset.click();
            await page.getByRole('dialog', { name: 'Reset to Recordio defaults' })
                .getByRole('button', { name: 'Reset', exact: true }).click();
            await expect(page.getByText('Back to Recordio defaults')).toBeVisible();
        }
        await expect(page.getByText('Using Recordio defaults')).toBeVisible();

        // A change: turn auto-zoom off (Motion tab)
        const nav = page.locator('#defaults-settings-nav');
        const autoZoom = page.getByRole('switch', { name: 'Auto-zoom' });
        await nav.getByRole('button', { name: 'Motion', exact: true }).click();
        await expect(autoZoom).toHaveAttribute('aria-checked', 'true');
        await autoZoom.click();
        await expect(autoZoom).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByText('Unsaved changes')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('personal-settings-dirty.png') });

        const save = page.getByRole('button', { name: 'Save defaults' });
        await expect(save).toBeEnabled();
        await save.click();
        await expect(page.getByText('Defaults saved')).toBeVisible();
        await expect(page.getByText('Custom defaults')).toBeVisible();

        // Survives a reload
        await page.reload();
        await expect(page.getByText('Loading defaults…')).toBeHidden();
        await expect(page.getByText('Custom defaults')).toBeVisible();
        await nav.getByRole('button', { name: 'Motion', exact: true }).click();
        await expect(autoZoom).toHaveAttribute('aria-checked', 'false');

        // Back to the shipped defaults (column → NULL)
        await reset.click();
        await page.getByRole('dialog', { name: 'Reset to Recordio defaults' })
            .getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(page.getByText('Back to Recordio defaults')).toBeVisible();
        await expect(page.getByText('Using Recordio defaults')).toBeVisible();
        await expect(autoZoom).toHaveAttribute('aria-checked', 'true');

        expect(saves, 'the defaults page must never save a project').toEqual([]);
    });
});
