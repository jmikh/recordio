import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BRIDGE_MSG } from '../../shared/types/bridge';
import { seedScreenshot, deleteScreenshot, type SeededScreenshot } from '../fixtures/screenshot';
import { installExtensionMock, type RecordedBridgeCall } from '../fixtures/extensionMock';

// Seeds a real screenshot (PNG in storage + row via the server API) once for
// this file and drives the screenshot product end to end: editor, autosave,
// share → public page, dashboard, and the extension handoff (plans/screenshots).
let seeded: SeededScreenshot;

test.beforeAll(async () => {
    seeded = await seedScreenshot();
});

test.afterAll(async () => {
    await seeded?.cleanup();
});

async function openEditor(page: import('@playwright/test').Page) {
    await page.goto(`/screenshot/${seeded.slug}/edit`);
    await expect(page.locator('#screenshot-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
    await expect(page.getByTestId('screenshot-canvas').locator('canvas')).toBeVisible();
    await expect(page.getByText('Loading screenshot...')).toBeHidden();
}

test('screenshot editor loads the seeded screenshot', async ({ page }) => {
    await openEditor(page);
    // Nothing selected: the inspector shows the image info
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('640 × 360 px');
});

test('a tool click creates an annotation and the change autosaves', async ({ page }) => {
    await openEditor(page);

    const saved = page.waitForResponse(r => r.url().endsWith('/screenshot-update') && r.ok(), { timeout: 15_000 });
    await page.getByRole('button', { name: 'Rectangle' }).click();
    await page.getByTestId('screenshot-canvas').click();

    // The new item is selected: its settings and Delete are in the inspector
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(inspector.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(inspector).toContainText('Rectangle');

    // Debounced autosave wrote the document
    await saved;
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
});

test('share dialog shows the owner controls and publishes to the public page', async ({ page, browser }) => {
    await openEditor(page);

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share screenshot' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Visibility' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();

    // Going public uploads the flattened render the public page serves
    const published = page.waitForResponse(r => r.url().endsWith('/screenshot-render-upload') && r.ok(), { timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Visibility' }).click();
    await page.getByRole('button', { name: 'Anyone with the link' }).click();
    await published;

    // A signed-out visitor sees the published image
    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(`/screenshot/${seeded.slug}`);
    await expect(visitor.getByRole('img', { name: seeded.name })).toBeVisible({ timeout: 15_000 });
    await expect(visitor.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await anon.close();
});

test('dashboard lists the screenshot in its own section and opens the editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Screenshots' }).click();
    await page.getByText(seeded.name).first().click();
    await expect(page).toHaveURL(/\/screenshot\/[^/]+\/edit/);
    await expect(page.locator('#screenshot-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
});

test.describe('extension handoff', () => {
    let createdScreenshotId: string | null = null;

    test.afterEach(async () => {
        if (createdScreenshotId) await deleteScreenshot(createdScreenshotId);
        createdScreenshotId = null;
    });

    test('import page receives a screenshot and opens the screenshot editor', async ({ page }) => {
        const screenshotId = randomUUID();
        const name = `e2e import shot ${screenshotId.slice(0, 8)}`;
        await installExtensionMock(page, { recordingId: screenshotId, name, kind: 'screenshot' });
        createdScreenshotId = screenshotId; // the capture id becomes the screenshot id

        await page.goto(`/import?id=${screenshotId}&ext=e2e-mock-extension&kind=screenshot`);

        await expect(page).toHaveURL(/\/screenshot\/[^/]+\/edit/, { timeout: 30_000 });
        await expect(page.locator('#screenshot-name-input')).toHaveValue(name, { timeout: 20_000 });
        await expect(page.getByTestId('screenshot-canvas').locator('canvas')).toBeVisible();

        const calls: RecordedBridgeCall[] = await page.evaluate(
            () => (window as unknown as { __extMockCalls: RecordedBridgeCall[] }).__extMockCalls,
        );
        const confirm = calls.find(c => c.type === BRIDGE_MSG.HANDOFF_COMPLETE);
        expect(confirm?.payload?.projectId).toBe(screenshotId);
    });
});
