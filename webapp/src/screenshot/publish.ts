/**
 * Publishing the flattened render the public page serves
 * (plans/screenshots Step 10). Idempotent per cloud version: a render is
 * uploaded only when the row is shared and `render_cloud_version` lags
 * the saved `cloud_version`.
 */
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { captureError } from '../lib/sentry';
import { trackScreenshotPublishFailed } from '../analytics';
import { ScreenshotService } from './screenshotService';
import { useScreenshotMetaStore } from './store/useScreenshotMetaStore';
import { renderToPngBlob } from './render/renderScreenshot';

const inFlight = new Set<string>();

/**
 * Renders + uploads when needed. Returns true when a render was
 * published (or was already current), false when skipped/failed.
 */
export async function publishRenderIfNeeded(image: CanvasImageSource, doc: ScreenshotDoc): Promise<boolean> {
    const metaStore = useScreenshotMetaStore.getState();
    const meta = metaStore.meta;
    if (!meta || meta.id !== doc.id) return false;
    if (meta.sharePolicy === 'private') return false;
    if (inFlight.has(doc.id)) return false;

    const cloudVersion = ScreenshotService.getCloudVersion(doc.id) ?? meta.cloudVersion;
    if (meta.renderCloudVersion === cloudVersion) return true;

    inFlight.add(doc.id);
    try {
        const blob = await renderToPngBlob(image, doc);
        let published = await ScreenshotService.publishRender(doc.id, blob, cloudVersion);
        if (published === null) {
            // The doc moved on while we rendered — one retry against the newest version
            const latest = ScreenshotService.getCloudVersion(doc.id) ?? cloudVersion;
            if (latest !== cloudVersion) published = await ScreenshotService.publishRender(doc.id, blob, latest);
        }
        if (published === null) return false;
        useScreenshotMetaStore.getState().setRenderCloudVersion(published);
        return true;
    } catch (err) {
        captureError(err, { flow: 'screenshot_publish', extra: { screenshotId: doc.id } });
        trackScreenshotPublishFailed({
            screenshot_id: doc.id,
            error: err instanceof Error ? err.message : String(err),
            is_offline: !navigator.onLine,
        });
        return false;
    } finally {
        inFlight.delete(doc.id);
    }
}
