/**
 * Seeds a real, editor-openable screenshot through the same paths the app
 * uses (plans/screenshots Step 12):
 *
 *   1. sign in the e2e user (fixtures/project.ts signIn)
 *   2. upload the fixture PNG to `project-media` at the screenshot's source
 *      path (service role — stands in for the tus upload the import page does)
 *   3. POST /screenshot-create with a doc built by the app's own
 *      createScreenshotDoc (so schemaVersion/defaults never drift)
 *   4. POST /screenshot-confirm-upload to flip upload_status → 'ready'
 *
 * Runs in Node (Playwright test process), not the browser.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createScreenshotDoc } from '../../webapp/src/screenshot/core/createScreenshotDoc';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './testUser';
import { api, signIn } from './project';

export const SCREENSHOT_PNG = path.join(import.meta.dirname, 'assets/screenshot.png');
export const SCREENSHOT_SIZE = { width: 640, height: 360 }; // matches the generated fixture

function sourceStoragePath(userId: string, screenshotId: string): string {
    return `${userId}/screenshots/${screenshotId}/source.png`;
}

async function uploadPng(storagePath: string) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${storagePath}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'image/png',
            'x-upsert': 'true',
        },
        body: readFileSync(SCREENSHOT_PNG),
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
}

async function deleteStoragePrefixObject(storagePath: string) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${storagePath}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
    }).catch(() => {});
}

export interface SeededScreenshot {
    screenshotId: string;
    slug: string;
    name: string;
    workspaceId: string;
    cleanup: () => Promise<void>;
}

export async function seedScreenshot(name = `e2e screenshot ${randomUUID().slice(0, 8)}`): Promise<SeededScreenshot> {
    const { token, userId } = await signIn();

    // The DEFAULT workspace — what the dashboard opens and where /import
    // creates rows (the oldest workspace can be a different, free one)
    const defaultWorkspace = await api('workspace-get-default', token, {});
    if (!defaultWorkspace?.id) throw new Error('e2e user has no default workspace — did auth.setup run?');
    const workspaceId = defaultWorkspace.id as string;

    const screenshotId = randomUUID();
    const storagePath = sourceStoragePath(userId, screenshotId);
    await uploadPng(storagePath);

    const doc = createScreenshotDoc(screenshotId, {
        storagePath: '',
        widthPx: SCREENSHOT_SIZE.width,
        heightPx: SCREENSHOT_SIZE.height,
        devicePixelRatio: 1,
        captureMode: 'visible',
        pageUrl: 'https://example.com/e2e',
        pageTitle: name,
    });

    const created = await api('screenshot-create', token, { screenshot: doc, name, workspaceId });
    await api('screenshot-confirm-upload', token, { screenshotId });

    const cleanup = async () => {
        await api('screenshot-delete', token, { screenshotId }).catch(() => {});
        await deleteStoragePrefixObject(storagePath);
    };

    return { screenshotId, slug: created.slug as string, name, workspaceId, cleanup };
}

/** Best-effort removal of a screenshot the app itself created (import flow). */
export async function deleteScreenshot(screenshotId: string): Promise<void> {
    const { token, userId } = await signIn();
    await api('screenshot-delete', token, { screenshotId }).catch(() => {});
    await deleteStoragePrefixObject(sourceStoragePath(userId, screenshotId));
}
