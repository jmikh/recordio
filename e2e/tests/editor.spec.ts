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
    await page.goto(`/editor?projectId=${seeded.projectId}`);

    // Project metadata reached the store: the header name input shows our name.
    // Generous timeout — first load downloads media and initializes the player.
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });

    // The editor shell rendered: canvas + timeline are up and the loading
    // overlay is gone.
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByText('Loading project...')).toBeHidden();
});

test('dashboard lists the seeded project and opens it', async ({ page }) => {
    await page.goto('/');

    // The project card is on the dashboard; clicking it navigates to the editor.
    await page.getByText(seeded.name).first().click();
    await expect(page).toHaveURL(new RegExp(`/editor\\?projectId=${seeded.projectId}`));
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
});
