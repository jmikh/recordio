/**
 * ScreenshotService — orchestration over ScreenshotStorage
 * (plans/screenshots Step 6), the screenshot sibling of
 * CloudProjectService: import from the extension handoff, load for the
 * editor, hash-guarded autosave with compare-and-set, thumbnails, the
 * flattened render for sharing, and the dashboard list.
 *
 * Cloud is the sole source of truth. The source PNG is cached in
 * BlobCache under its storage path so the editor opens without a
 * download right after import.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { AccessRole, CloudScreenshot, SharePolicy } from '@shared/api';
import type { RawScreenshot, ScreenshotCaptureMode, ScreenshotDoc } from '@shared/types';
import { BlobCache } from '../storage/blobCache';
import { CloudStorage } from '../storage/cloudStorage';
import { dataHash, blobHash } from '../storage/dataHash';
import { useSyncStatusStore } from '../storage/syncStatusStore';
import { captureError } from '../lib/sentry';
import { ScreenshotStorage, ScreenshotVersionConflictError } from './api/screenshotStorage';
import { createScreenshotDoc, fitSourceImage, readImageSize, sourceFromRaw } from './core/createScreenshotDoc';
import { migrateScreenshotDoc } from './core/migrateScreenshotDoc';

/** Row metadata the editor and share UI need that isn't part of the document / undo history. */
export interface ScreenshotShareMeta {
    id: string;
    slug: string;
    name: string;
    ownerId: string;
    createdBy: string;
    workspaceId: string;
    sharePolicy: SharePolicy;
    workspaceAccess: AccessRole;
    ownerName: string | null;
    ownerEmail: string;
    cloudVersion: number;
    /** cloud_version the published render was made from (null = never published) */
    renderCloudVersion: number | null;
    /** null until the editor uploads one */
    thumbnailStoragePath: string | null;
}

/** Dashboard list row (screenshot-list summary, camelCased, with a resolvable thumbnail). */
export interface ScreenshotListItem {
    id: string;
    name: string;
    slug: string;
    thumbnail: string | null;
    thumbnailStoragePath: string | null;
    widthPx: number;
    heightPx: number;
    captureMode: ScreenshotCaptureMode;
    pageUrl: string | null;
    createdAt: string;
    updatedAt: string;
    lastAccessedAt: string | null;
    ownerId: string;
    deletedAt: string | null;
    isShared: boolean;
    sharePolicy: SharePolicy;
    workspaceAccess: AccessRole;
    cloudVersion: number;
}

export interface LoadedScreenshot {
    doc: ScreenshotDoc;
    meta: ScreenshotShareMeta;
    /** Object URL of the source PNG (caller revokes when done) */
    imageUrl: string;
}

/** Name for a fresh capture: the page title, or "Screenshot". */
export function screenshotNameFor(raw: RawScreenshot): string {
    const title = raw.page.title.trim();
    if (!title) return 'Screenshot';
    return title.length > 40 ? `${title.slice(0, 40).trimEnd()}…` : title;
}

export function toScreenshotMeta(row: CloudScreenshot): ScreenshotShareMeta {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        ownerId: row.owner_id,
        createdBy: row.created_by,
        workspaceId: row.workspace_id,
        sharePolicy: row.share_policy,
        workspaceAccess: row.workspace_access,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        cloudVersion: row.cloud_version,
        renderCloudVersion: row.render_cloud_version,
        thumbnailStoragePath: row.thumbnail_storage_path,
    };
}

/** True when a create call was refused with 403 { error: 'screenshot_cap_reached' }. */
export async function readScreenshotCapError(error: unknown): Promise<{ cap: number | null } | null> {
    if (!(error instanceof FunctionsHttpError)) return null;
    const response = (error as { context?: unknown }).context;
    if (!(response instanceof Response)) return null;
    try {
        const body = await response.clone().json();
        return body?.error === 'screenshot_cap_reached'
            ? { cap: typeof body.cap === 'number' ? body.cap : null }
            : null;
    } catch {
        return null;
    }
}

export class ScreenshotService {
    private static cloudVersions = new Map<string, number>();
    private static docHashes = new Map<string, string>();
    private static thumbnailHashes = new Map<string, string>();
    private static saveInFlight = new Set<string>();

    static getCloudVersion(screenshotId: string): number | undefined {
        return this.cloudVersions.get(screenshotId);
    }

    /** After a load or a successful save elsewhere (conflict reload). */
    static setCloudVersion(screenshotId: string, version: number): void {
        this.cloudVersions.set(screenshotId, version);
    }

    // ─── Import ──────────────────────────────────────────────────

    /**
     * Creates the row, caches the PNG locally, AWAITS the TUS upload and
     * confirms — a screenshot is one small file, so unlike video there is
     * no pending state for the editor to babysit. Throws the raw
     * FunctionsHttpError on the cap refusal (see readScreenshotCapError).
     */
    static async importScreenshot(
        raw: RawScreenshot,
        image: Blob,
        workspaceId: string,
        onProgress?: (fraction: number) => void,
    ): Promise<{ id: string; slug: string; name: string; doc: ScreenshotDoc }> {
        const fitted = await fitSourceImage(image, await readImageSize(image));
        const doc = createScreenshotDoc(raw.id, sourceFromRaw(raw, fitted.size));
        const name = screenshotNameFor(raw);

        const created = await ScreenshotStorage.create(doc, name, workspaceId);
        doc.source.storagePath = created.storagePath;

        await BlobCache.put(created.storagePath, fitted.blob);
        await CloudStorage.uploadBlobResumable(created.bucket, created.storagePath, fitted.blob, 'image/png', onProgress);
        await ScreenshotStorage.confirmUpload(created.screenshotId);

        this.cloudVersions.set(created.screenshotId, 1);
        this.docHashes.set(created.screenshotId, await dataHash(doc));
        return { id: created.screenshotId, slug: created.slug, name, doc };
    }

    // ─── Load ────────────────────────────────────────────────────

    static async loadScreenshot(
        ref: { screenshotId: string } | { slug: string },
        onStatus?: (status: string) => void,
    ): Promise<LoadedScreenshot | null> {
        onStatus?.('Loading screenshot...');
        const row = await ScreenshotStorage.get(ref);
        if (!row) return null;

        const doc = migrateScreenshotDoc(row.screenshot_data);
        // The row columns are authoritative for the source
        doc.source = {
            ...doc.source,
            storagePath: row.source_storage_path,
            widthPx: row.width_px,
            heightPx: row.height_px,
            captureMode: row.capture_mode,
        };

        this.cloudVersions.set(row.id, row.cloud_version);
        this.docHashes.set(row.id, await dataHash(doc));

        onStatus?.('Loading image...');
        const imageUrl = await BlobCache.getBlobUrl(row.source_storage_path);
        return { doc, meta: toScreenshotMeta(row), imageUrl };
    }

    // ─── Save ────────────────────────────────────────────────────

    /**
     * Autosave target. Skips unchanged docs (hash) and overlapping calls;
     * a compare-and-set loss sets `screenshotConflict` on the sync store
     * for the editor's conflict modal. Never throws.
     */
    static async saveScreenshot(doc: ScreenshotDoc): Promise<void> {
        const id = doc.id;
        if (this.saveInFlight.has(id)) return;

        const hash = await dataHash(doc);
        if (this.docHashes.get(id) === hash) return;

        this.saveInFlight.add(id);
        const store = useSyncStatusStore.getState();
        store.setSyncing();
        try {
            const expectedVersion = this.cloudVersions.get(id);
            const cloudVersion = await ScreenshotStorage.update(id, doc, expectedVersion);
            this.cloudVersions.set(id, cloudVersion);
            this.docHashes.set(id, hash);
            store.setLastSyncedAt(new Date());
            store.setIdle();
        } catch (err) {
            if (err instanceof ScreenshotVersionConflictError) {
                store.setScreenshotConflict({ screenshotId: id });
                store.setIdle();
            } else {
                captureError(err, { flow: 'screenshot_save', extra: { screenshotId: id } });
                store.setError(err instanceof Error ? err.message : 'Save failed');
            }
        } finally {
            this.saveInFlight.delete(id);
        }
    }

    /** Explicit (non-debounced) save that surfaces errors — the conflict "keep mine" path. */
    static async forceSave(doc: ScreenshotDoc): Promise<number> {
        const cloudVersion = await ScreenshotStorage.update(doc.id, doc);
        this.cloudVersions.set(doc.id, cloudVersion);
        this.docHashes.set(doc.id, await dataHash(doc));
        return cloudVersion;
    }

    static async renameScreenshot(screenshotId: string, name: string): Promise<void> {
        await ScreenshotStorage.rename(screenshotId, name);
    }

    // ─── Thumbnail / render ──────────────────────────────────────

    /** Dedupes by content hash; uploads in the background and caches the result. */
    static async saveThumbnail(screenshotId: string, blob: Blob): Promise<void> {
        const hash = await blobHash(blob);
        if (this.thumbnailHashes.get(screenshotId) === hash) return;
        this.thumbnailHashes.set(screenshotId, hash);

        ScreenshotStorage.uploadThumbnail(screenshotId, blob)
            .then(storagePath => BlobCache.put(storagePath, blob))
            .catch(err => {
                this.thumbnailHashes.delete(screenshotId);
                captureError(err, { flow: 'screenshot_thumbnail_upload', extra: { screenshotId } });
            });
    }

    /**
     * Uploads the flattened PNG for the public page, keyed by the cloud
     * version it was rendered from. Returns the render's version, or null
     * on 409 (the doc moved on — render again from the latest state).
     */
    static async publishRender(screenshotId: string, blob: Blob, cloudVersion: number): Promise<number | null> {
        try {
            const result = await ScreenshotStorage.uploadRender(screenshotId, cloudVersion, blob);
            return result.renderCloudVersion;
        } catch (err) {
            if (err instanceof FunctionsHttpError && err.context?.status === 409) return null;
            throw err;
        }
    }

    // ─── Share / lifecycle ───────────────────────────────────────

    static async shareScreenshot(screenshotId: string, sharePolicy: SharePolicy, workspaceAccess?: AccessRole): Promise<string> {
        return ScreenshotStorage.share(screenshotId, sharePolicy, workspaceAccess);
    }

    static async deleteScreenshot(screenshotId: string): Promise<void> {
        await ScreenshotStorage.softDelete(screenshotId);
    }

    static async restoreScreenshot(screenshotId: string): Promise<boolean> {
        return ScreenshotStorage.restore(screenshotId);
    }

    // ─── List ────────────────────────────────────────────────────

    static async listScreenshots(workspaceId: string): Promise<ScreenshotListItem[]> {
        const rows = await ScreenshotStorage.list(workspaceId);
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            thumbnail: null,
            thumbnailStoragePath: row.thumbnail_storage_path,
            widthPx: row.width_px,
            heightPx: row.height_px,
            captureMode: row.capture_mode,
            pageUrl: row.page_url,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastAccessedAt: row.last_accessed_at,
            ownerId: row.owner_id,
            deletedAt: row.deleted_at,
            isShared: row.is_shared,
            sharePolicy: row.share_policy,
            workspaceAccess: row.workspace_access,
            cloudVersion: row.cloud_version,
        }));
    }

    /** Batch-resolves thumbnails (one signed-URL call for all cache misses). */
    static loadThumbnails(
        items: ScreenshotListItem[],
        onThumbnailLoaded: (screenshotId: string, thumbnailUrl: string) => void,
    ): void {
        const withThumbnails = items.filter(item => item.thumbnailStoragePath);
        if (withThumbnails.length === 0) return;

        BlobCache.getBlobUrls(withThumbnails.map(item => item.thumbnailStoragePath!))
            .then(blobUrls => {
                for (const item of withThumbnails) {
                    const url = blobUrls[item.thumbnailStoragePath!];
                    if (url) onThumbnailLoaded(item.id, url);
                }
            })
            .catch(err => captureError(err, { flow: 'screenshot_thumbnail_batch_load' }));
    }
}
