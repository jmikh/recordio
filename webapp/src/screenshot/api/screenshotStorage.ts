/**
 * Transport for the screenshot routes (plans/screenshots Step 6) —
 * thin wrappers over invokeFunction / invokeFunctionUpload that throw on
 * error, mirroring CloudStorage for projects. No orchestration here:
 * caching, hashing, version tracking live in ../screenshotService.ts.
 */
import { invokeFunction, invokeFunctionUpload } from '../../api/client';
import type { ScreenshotDoc } from '@shared/types';
import type {
    AccessRole,
    CloudScreenshot,
    CloudScreenshotSummary,
    ScreenshotCreateRequest,
    ScreenshotCreateResponse,
    ScreenshotGetRequest,
    ScreenshotRenderUploadResponse,
    ScreenshotThumbnailResponse,
    SharedScreenshotGetResponse,
    SharePolicy,
} from '@shared/api';

/** Thrown when screenshot-update's compare-and-set loses to another writer. */
export class ScreenshotVersionConflictError extends Error {
    constructor(public screenshotId: string, public expectedVersion: number) {
        super(`Cloud version conflict for screenshot ${screenshotId} (expected v${expectedVersion})`);
        this.name = 'ScreenshotVersionConflictError';
    }
}

export class ScreenshotStorage {
    /** Creates the row (pending) and returns where to TUS-upload the source PNG. */
    static async create(doc: ScreenshotDoc, name: string, workspaceId: string): Promise<ScreenshotCreateResponse> {
        const body: ScreenshotCreateRequest = { screenshot: doc, name, workspaceId };
        const { data, error } = await invokeFunction('screenshot-create', body);
        if (error) throw error;
        return data;
    }

    static async confirmUpload(screenshotId: string): Promise<void> {
        const { data, error } = await invokeFunction('screenshot-confirm-upload', { screenshotId });
        if (error) throw error;
        if (!data.confirmed) console.warn('[ScreenshotStorage] confirm-upload returned false — screenshot may already be ready');
    }

    /** By id or by slug; null when the row doesn't exist (403 throws). */
    static async get(ref: { screenshotId: string } | { slug: string }): Promise<CloudScreenshot | null> {
        // Widened — the union confuses the typed overload into the untyped fallback
        const { data, error } = await invokeFunction('screenshot-get', ref as ScreenshotGetRequest);
        if (error) throw error;
        return data;
    }

    static async list(workspaceId: string): Promise<CloudScreenshotSummary[]> {
        const { data, error } = await invokeFunction('screenshot-list', { workspaceId });
        if (error) throw error;
        return data.screenshots ?? [];
    }

    /**
     * Saves the document; returns the new cloud_version. `expectedVersion`
     * undefined is OMITTED by JSON.stringify (no version check) — never
     * send null (the integer schema would coerce it to 0).
     */
    static async update(screenshotId: string, doc: ScreenshotDoc, expectedVersion?: number): Promise<number> {
        const { data, error } = await invokeFunction('screenshot-update', {
            screenshotId,
            screenshotData: JSON.parse(JSON.stringify(doc)),
            expectedVersion,
        });
        if (error) throw error;
        if (data.cloudVersion === null) {
            throw new ScreenshotVersionConflictError(screenshotId, expectedVersion!);
        }
        return data.cloudVersion;
    }

    static async rename(screenshotId: string, name: string): Promise<void> {
        const { error } = await invokeFunction('screenshot-rename', { screenshotId, name });
        if (error) throw error;
    }

    static async softDelete(screenshotId: string): Promise<void> {
        const { error } = await invokeFunction('screenshot-delete', { screenshotId });
        if (error) throw error;
    }

    static async restore(screenshotId: string): Promise<boolean> {
        const { data, error } = await invokeFunction('screenshot-restore', { screenshotId });
        if (error) throw error;
        return data.restored ?? false;
    }

    /** Owner-only; returns the (permanent) slug. */
    static async share(screenshotId: string, sharePolicy: SharePolicy, workspaceAccess?: AccessRole): Promise<string> {
        const { data, error } = await invokeFunction('screenshot-share', { screenshotId, sharePolicy, workspaceAccess });
        if (error) throw error;
        return data.slug;
    }

    /** Multipart; returns the thumbnail's storage path (under the creator's prefix). */
    static async uploadThumbnail(screenshotId: string, blob: Blob): Promise<string> {
        const form = new FormData();
        form.append('screenshotId', screenshotId);
        form.append('file', blob, 'thumbnail.webp');
        const { data, error } = await invokeFunction<ScreenshotThumbnailResponse>('screenshot-update-thumbnail', form);
        if (error) throw error;
        return data.storagePath;
    }

    /**
     * Multipart upload of the flattened PNG the public page serves. The
     * server 409s (version_mismatch) when `cloudVersion` is no longer
     * current — the caller re-renders from the latest doc and retries.
     */
    static async uploadRender(
        screenshotId: string,
        cloudVersion: number,
        blob: Blob,
        onProgress?: (fraction: number) => void,
    ): Promise<ScreenshotRenderUploadResponse> {
        const form = new FormData();
        form.append('screenshotId', screenshotId);
        form.append('cloudVersion', String(cloudVersion));
        form.append('file', blob, `v${cloudVersion}.png`);
        const { data, error } = await invokeFunctionUpload<ScreenshotRenderUploadResponse>(
            'screenshot-render-upload',
            form,
            onProgress,
        );
        if (error) throw error;
        return data;
    }

    /** Public view page payload (works signed out; 403 → auth_required, 404 → not found). */
    static async sharedGet(slug: string): Promise<SharedScreenshotGetResponse> {
        const { data, error } = await invokeFunction('shared-screenshot-get', { slug });
        if (error) throw error;
        return data;
    }
}
