import { test, expect } from '@playwright/test';
import { seedProject, type SeededProject } from '../fixtures/project';

// Seeds a real project (media in storage + rows via the server API) once for
// this file, opens it in the editor, and verifies the editor actually loads it.
let seeded: SeededProject;

test.beforeAll(async () => {
    seeded = await seedProject();
});

test.afterAll(async () => {
    await seeded?.cleanup();
});

test('editor opens a project: media hydrates and the UI renders', async ({ page }) => {
    // Legacy URL — the editor loads it, then redirects to /video/{slug}/edit
    await page.goto(`/editor?projectId=${seeded.projectId}`);

    // Project metadata reached the store: the header name input shows our name.
    // Generous timeout — first load downloads media and initializes the player.
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/video\/[^/]+\/edit/);

    // The editor shell rendered: canvas + timeline are up and the loading
    // overlay is gone.
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByText('Loading project...')).toBeHidden();
});

test('share modal opens with the owner controls', async ({ page }) => {
    await page.goto(`/editor?projectId=${seeded.projectId}`);
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share project' });
    await expect(dialog).toBeVisible();
    // Owner controls: visibility dropdown, workspace access when shareable, copy link
    await expect(dialog.getByRole('button', { name: 'Visibility' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
});

test('dashboard lists the seeded project and opens it', async ({ page }) => {
    await page.goto('/');

    // The project card is on the dashboard; clicking it navigates to the
    // editor at /video/{slug}/edit (the caller owns the seeded project).
    await page.getByText(seeded.name).first().click();
    await expect(page).toHaveURL(/\/video\/[^/]+\/edit/);
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
});

test('nav drawer pulls the main sidebar out over the editor and pauses playback', async ({ page }) => {
    await page.goto(`/editor?projectId=${seeded.projectId}`);
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
    await expect(page.locator('canvas').first()).toBeVisible();

    const elapsed = page.locator('.tabular-nums').first();

    // Start playback, then pull the nav out over it
    await page.locator('#video-player-container').click();
    await page.keyboard.press('Space');
    await expect(elapsed).not.toHaveText('0:00.0');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'New Recording' })).toBeVisible();

    // Playback stopped, and Space doesn't restart it behind the backdrop
    await page.waitForTimeout(300);
    const stoppedAt = await elapsed.innerText();
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    await expect(elapsed).toHaveText(stoppedAt);

    // The editor behind is dimmed — the backdrop takes the clicks
    expect(await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth - 100, window.innerHeight / 2);
        return el?.className?.toString() ?? '';
    })).toContain('bg-black/60');

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
});

test('nav drawer deep-links a dashboard view', async ({ page }) => {
    await page.goto(`/editor?projectId=${seeded.projectId}`);
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog', { name: 'Main navigation' })
        .getByRole('button', { name: /^Trash/ }).click();

    // Lands on the dashboard with Trash selected, and ?view= is cleaned off
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: /^Trash/ })).toHaveAttribute('aria-current', 'true');
});
