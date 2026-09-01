import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BRIDGE_MSG } from '../../shared/types/bridge';
import { installExtensionMock, type RecordedBridgeCall } from '../fixtures/extensionMock';
import { deleteProject } from '../fixtures/project';

// The /import page talks to the extension exclusively through
// chrome.runtime.sendMessage/connect, which don't exist in a plain Playwright
// page. installExtensionMock fakes the extension side (metadata response +
// chunked port streaming of the fixture recording), so everything downstream —
// blob reassembly, project creation, media upload, redirect to the editor —
// runs for real against the local stack.

let createdProjectId: string | null = null;

test.afterEach(async () => {
    if (createdProjectId) await deleteProject(createdProjectId);
    createdProjectId = null;
});

test('import page streams the recording from the extension and opens the editor', async ({ page }) => {
    const recordingId = randomUUID();
    const name = `e2e import ${recordingId.slice(0, 8)}`;
    await installExtensionMock(page, { recordingId, name });
    createdProjectId = recordingId; // the recording id becomes the project id

    await page.goto(`/import?id=${recordingId}&ext=e2e-mock-extension`);

    // Handoff completed → project created → SPA redirect into the editor.
    await expect(page).toHaveURL(new RegExp(`/editor\\?projectId=${recordingId}`), { timeout: 20_000 });
    await expect(page.locator('#project-name-input')).toHaveValue(name, { timeout: 20_000 });
    await expect(page.locator('canvas').first()).toBeVisible();

    // The page confirmed the handoff so the extension can delete its copy.
    const calls: RecordedBridgeCall[] = await page.evaluate(
        () => (window as unknown as { __extMockCalls: RecordedBridgeCall[] }).__extMockCalls,
    );
    const confirm = calls.find(c => c.type === BRIDGE_MSG.HANDOFF_COMPLETE);
    expect(confirm?.payload?.projectId).toBe(recordingId);
});

test('import page surfaces an extension-side failure', async ({ page }) => {
    const recordingId = randomUUID();
    await installExtensionMock(page, {
        recordingId,
        failWith: { error: 'Recording not found', code: 'NOT_FOUND' },
    });

    await page.goto(`/import?id=${recordingId}&ext=e2e-mock-extension`);

    await expect(page.getByText('Failed to receive recording')).toBeVisible();
    await expect(page.getByText('Recording not found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to Dashboard' })).toBeVisible();
});
