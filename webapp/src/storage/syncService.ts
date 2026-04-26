import type { Project, ID } from '../types';
import * as Sentry from '@sentry/react';
import { LocalStorage } from './localStorage';
import { CloudStorage, CloudVersionConflictError, type CloudProjectSummary, type MediaFileType } from './cloudStorage';
import { useSyncStatusStore } from './syncStatusStore';

/**
 * Item in the merged project list (local + cloud).
 * ID is the same everywhere (local IndexedDB key = cloud PK).
 */
export interface ProjectListItem {
    id: string;
    name: string;
    thumbnail: string | null;
    updatedAt: string;
    createdAt: string;
    lastAccessedAt: string | null;
    expiresAt: string | null;
    cloudSynced: boolean;
    cfVideoUid: string | null;
    cloudVersion: number | null;
    /** Duration in milliseconds (from output windows) */
    durationMs: number | null;
}

// Cloud sync debounce (30 seconds)
const CLOUD_SYNC_DEBOUNCE_MS = 30_000;

/**
 * SyncService — orchestrates IndexedDB ↔ cloud sync for project metadata + media.
 *
 * Usage:
 *   - Auto-save subscriber calls `SyncService.saveProject()` instead of `LocalStorage.saveProject()`.
 *   - Dashboard calls `SyncService.listProjects()` for a merged local + cloud list.
 *   - Login triggers `SyncService.onLogin()` to sync cloud project list.
 *   - Import triggers `SyncService.onProjectCreated()` to upload metadata + queue media.
 *   - App startup calls `SyncService.resumePendingUploads()` to resume interrupted uploads.
 */
export class SyncService {
    private static cloudSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Tracks in-flight media uploads to prevent duplicates */
    private static activeUploads = new Set<string>();

    /**
     * Compute SHA-256 hash of the cloud-serializable project data.
     * Used to skip no-op cloud writes when the project hasn't changed.
     */
    private static async projectDataHash(project: Project): Promise<string> {
        const stripped = CloudStorage.stripForCloud(project);
        const json = JSON.stringify(stripped);
        const buffer = new TextEncoder().encode(json);
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Set the baseline project hash after loading a project.
     * Prevents the auto-save subscriber from triggering a no-op cloud write
     * when the project hasn't been edited.
     */
    static async initProjectHash(project: Project): Promise<void> {
        const hash = await this.projectDataHash(project);
        const syncMeta = await LocalStorage.getSyncMeta(project.id);
        if (syncMeta) {
            await LocalStorage.saveSyncMeta({ ...syncMeta, projectHash: hash });
        }
    }

    /**
     * Save project to IndexedDB (fast) + queue cloud sync (debounced).
     * Replaces direct `LocalStorage.saveProject()` calls in auto-save.
     */
    static async saveProject(project: Project, userId: string | null, isPro: boolean): Promise<void> {
        // 1. Always save locally first (fast path)
        await LocalStorage.saveProject(project);

        // 2. Queue cloud sync if authenticated
        if (userId) {
            this.queueCloudSync(project, userId, isPro);
        }
    }

    /**
     * Debounced cloud sync — writes project metadata to cloud every 30s.
     * Also flushes on beforeunload (see setupBeforeUnloadFlush).
     */
    private static queueCloudSync(project: Project, userId: string, isPro: boolean): void {
        const projectId = project.id;

        // Clear existing timer for this project
        const existing = this.cloudSyncTimers.get(projectId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            this.cloudSyncTimers.delete(projectId);
            await this.syncProjectToCloud(project, userId, isPro);
        }, CLOUD_SYNC_DEBOUNCE_MS);

        this.cloudSyncTimers.set(projectId, timer);
    }

    /**
     * Immediately sync a project's metadata to cloud.
     * Public alias: `syncNow` (used when editor detects local is ahead of cloud on open).
     */
    static async syncNow(project: Project, userId: string, isPro: boolean): Promise<void> {
        return this.syncProjectToCloud(project, userId, isPro);
    }

    private static async syncProjectToCloud(project: Project, userId: string, isPro: boolean): Promise<void> {
        const store = useSyncStatusStore.getState();
        store.setSyncing();

        try {
            const syncMeta = await LocalStorage.getSyncMeta(project.id);

            // Only sync projects that are fully cloud-synced (media uploaded + ready)
            if (!syncMeta?.cloudSynced) {
                store.setIdle();
                return;
            }

            // Skip cloud write if project data hasn't changed since last sync
            const hash = await this.projectDataHash(project);
            if (syncMeta.projectHash === hash) {
                store.setIdle();
                return;
            }

            const result = await CloudStorage.saveProjectMetadata(
                project,
                userId,
                syncMeta.cloudVersion,
                isPro,
            );

            // Update local sync metadata (including new project hash)
            await LocalStorage.saveSyncMeta({
                ...syncMeta,
                cloudVersion: result.cloudVersion,
                lastSyncedAt: Date.now(),
                projectHash: hash,
            });

            store.setLastSyncedAt(new Date());
            store.setIdle();

            // Upload thumbnail in background (non-blocking, best-effort)
            this.syncThumbnailToCloud(project.id).catch(err => {
                console.warn('[SyncService] Thumbnail sync failed:', err);
                Sentry.captureException(err, { extra: { phase: 'thumbnail_sync', projectId: project.id } });
            });
        } catch (err) {
            if (err instanceof CloudVersionConflictError) {
                store.setConflict({ projectId: err.projectId, projectName: project.name });
                store.setIdle();
            } else {
                console.error('[SyncService] Cloud sync failed:', err);
                Sentry.captureException(err, { extra: { phase: 'cloud_sync', projectId: project.id } });
                store.setError(err instanceof Error ? err.message : 'Cloud sync failed');
            }
        }
    }

    /**
     * Flush any pending cloud syncs immediately (called on beforeunload / route change).
     */
    static async flushPendingSync(project: Project, userId: string | null, isPro: boolean): Promise<void> {
        if (!userId) return;

        const projectId = project.id;
        const timer = this.cloudSyncTimers.get(projectId);
        if (timer) {
            clearTimeout(timer);
            this.cloudSyncTimers.delete(projectId);
            await this.syncProjectToCloud(project, userId, isPro);
        }
    }

    /**
     * List projects — merges local IndexedDB projects with cloud projects.
     * Since local ID === cloud ID, matching is trivial.
     */
    static async listProjects(
        userId: string | null,
        onThumbnailLoaded?: (projectId: string, thumbnailUrl: string) => void,
    ): Promise<ProjectListItem[]> {
        const localProjects = await LocalStorage.listProjects();
        const localMap = new Map(localProjects.map(p => [p.id, p]));

        // If not authenticated, show only local-only projects (never synced to any account)
        if (!userId) {
            const allSyncMeta = await LocalStorage.listSyncMeta();
            const syncedIds = new Set(allSyncMeta.map(m => m.projectId));
            return localProjects
                .filter(p => !syncedIds.has(p.id))
                .map(p => this.localToListItem(p));
        }

        // Fetch cloud projects
        let cloudProjects: CloudProjectSummary[] = [];
        let cloudFetchFailed = false;
        try {
            cloudProjects = await CloudStorage.listProjectsSummary();
        } catch (err) {
            cloudFetchFailed = true;
            console.error('[SyncService] Failed to fetch cloud projects:', err);
            Sentry.captureException(err, { extra: { phase: 'list_projects_cloud_fetch' } });
            useSyncStatusStore.getState().setError('Failed to load cloud projects');
        }

        const result: ProjectListItem[] = [];
        const cloudIds = new Set<string>();

        // Pre-fetch all sync meta for local lastAccessedAt
        const allSyncMetaForAccess = await LocalStorage.listSyncMeta();
        const syncMetaAccessMap = new Map(allSyncMetaForAccess.map(m => [m.projectId, m]));

        // 1. Cloud projects — attach local thumbnail if available, queue download if not
        const thumbnailDownloads: Promise<void>[] = [];
        for (const cloud of cloudProjects) {
            cloudIds.add(cloud.id);
            const local = localMap.get(cloud.id);
            const meta = syncMetaAccessMap.get(cloud.id);
            result.push({
                id: cloud.id,
                name: cloud.name,
                thumbnail: local?.thumbnail ?? null,
                updatedAt: cloud.updated_at,
                createdAt: cloud.created_at,
                lastAccessedAt: meta?.lastAccessedAt
                    ? new Date(meta.lastAccessedAt).toISOString()
                    : cloud.last_accessed_at,
                expiresAt: cloud.expires_at,
                cloudSynced: true,
                cfVideoUid: cloud.cf_video_uid,
                cloudVersion: cloud.cloud_version,
                durationMs: cloud.duration_ms,
            });

            // Download cloud thumbnail in background if missing locally
            if (cloud.thumbnail_storage_path) {
                thumbnailDownloads.push(
                    this.downloadThumbnailIfMissing(cloud.id, cloud.thumbnail_storage_path)
                        .then(() => {
                            if (!onThumbnailLoaded) return;
                            return LocalStorage.getThumbnail(cloud.id).then(blob => {
                                if (blob) onThumbnailLoaded(cloud.id, URL.createObjectURL(blob));
                            });
                        })
                        .catch(err => console.warn(`[SyncService] Thumbnail download failed for ${cloud.id}:`, err))
                );
            }
        }

        // Fire thumbnail downloads in parallel (non-blocking for list return)
        if (thumbnailDownloads.length > 0) {
            Promise.all(thumbnailDownloads).catch(() => {});
        }

        // 2. Local-only projects
        for (const local of localProjects) {
            if (cloudIds.has(local.id)) continue;

            const hasSyncMeta = syncMetaAccessMap.has(local.id);

            const syncMeta = syncMetaAccessMap.get(local.id);
            if (hasSyncMeta && syncMeta?.cloudSynced && !cloudFetchFailed) {
                // Was fully synced to cloud but no longer exists there — delete local copy
                console.log(`[SyncService] Project ${local.id} deleted from cloud, removing local copy`);
                LocalStorage.deleteProject(local.id).catch(console.error);
            } else {
                // Genuinely local-only (never synced), or cloud fetch failed so we keep it
                result.push(this.localToListItem(local));
            }
        }

        // Sort by updatedAt descending
        result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return result;
    }

    /**
     * Called after recording import — uploads metadata to cloud + queues media uploads.
     */
    static async onProjectCreated(
        project: Project,
        userId: string | null,
        isPro: boolean,
    ): Promise<void> {
        if (!userId) return;

        try {
            const result = await CloudStorage.saveProjectMetadata(project, userId, undefined, isPro);

            await LocalStorage.saveSyncMeta({
                projectId: project.id,
                userId,
                cloudVersion: result.cloudVersion,
                cloudSynced: false,
                lastSyncedAt: Date.now(),
            });

            // Queue media uploads in background (non-blocking)
            this.uploadProjectMedia(project.id).catch(err => {
                console.error(`[SyncService] Background media upload failed for ${project.id}:`, err);
                Sentry.captureException(err, { extra: { phase: 'background_media_upload', projectId: project.id } });
            });
        } catch (err) {
            console.error('[SyncService] Failed to create cloud project:', err);
            Sentry.captureException(err, { extra: { phase: 'create_cloud_project', projectId: project.id } });
        }
    }

    /**
     * Called on login — syncs local projects to cloud.
     * Uploads metadata for any local projects that don't have syncMeta.
     */
    static async onLogin(userId: string, isPro: boolean): Promise<void> {
        const localProjects = await LocalStorage.listProjects();
        const allSyncMeta = await LocalStorage.listSyncMeta();
        const syncMetaMap = new Map(allSyncMeta.map(m => [m.projectId, m]));

        // Find local projects without syncMeta (never synced)
        const unsyncedProjects = localProjects.filter(p => !syncMetaMap.has(p.id));

        console.log(`[SyncService] onLogin: ${localProjects.length} local, ${allSyncMeta.length} synced, ${unsyncedProjects.length} to sync`);

        // Sort by updatedAt descending (most recent first)
        unsyncedProjects.sort((a, b) => {
            const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bTime - aTime;
        });

        // Upload metadata for unsynced projects (most recent first)
        for (const project of unsyncedProjects) {
            try {
                await this.onProjectCreated(project, userId, isPro);
                console.log(`[SyncService] Synced project ${project.id} to cloud`);
            } catch (err) {
                console.error(`[SyncService] Failed to sync project ${project.id} on login:`, err);
                Sentry.captureException(err, { extra: { phase: 'on_login_sync', projectId: project.id } });
            }
        }
    }

    /**
     * Delete a project locally and soft-delete in cloud.
     */
    static async deleteProject(projectId: ID): Promise<void> {
        // Cloud soft-delete (uses project ID directly — same as cloud PK)
        try {
            await CloudStorage.softDeleteProject(projectId);
        } catch (err) {
            console.error('[SyncService] Failed to soft-delete cloud project:', err);
            Sentry.captureException(err, { extra: { phase: 'soft_delete', projectId } });
        }

        // Local delete
        await LocalStorage.deleteProject(projectId);
    }

    /**
     * Resolve a version conflict by reloading cloud data (discard local).
     */
    static async resolveConflictReload(projectId: string): Promise<Project | null> {
        const cloudProject = await CloudStorage.loadProjectMetadata(projectId);
        if (!cloudProject) return null;

        const rawProject = cloudProject.project_data as Project;
        rawProject.id = projectId;
        await LocalStorage.saveProject(rawProject);

        const syncMeta = await LocalStorage.getSyncMeta(projectId);
        const hash = await this.projectDataHash(rawProject);
        await LocalStorage.saveSyncMeta({
            projectId,
            userId: syncMeta?.userId ?? '',
            cloudVersion: cloudProject.cloud_version,
            cloudSynced: true,
            lastSyncedAt: Date.now(),
            projectHash: hash,
        });

        useSyncStatusStore.getState().clearConflict();

        // Re-load through loadProjectOrFail to hydrate runtimeUrls from IndexedDB blobs
        return LocalStorage.loadProjectOrFail(projectId);
    }

    /**
     * Resolve a version conflict by force-pushing local version to cloud.
     */
    static async resolveConflictForce(
        project: Project,
        userId: string,
        isPro: boolean,
    ): Promise<void> {
        const cloudVersion = await CloudStorage.getCloudVersion(project.id);
        if (cloudVersion === null) return;

        const result = await CloudStorage.saveProjectMetadata(
            project,
            userId,
            cloudVersion,
            isPro,
        );

        const hash = await this.projectDataHash(project);
        await LocalStorage.saveSyncMeta({
            projectId: project.id,
            userId,
            cloudVersion: result.cloudVersion,
            cloudSynced: true,
            lastSyncedAt: Date.now(),
            projectHash: hash,
        });

        useSyncStatusStore.getState().clearConflict();
    }

    // ─── Media Upload / Download ──────────────────────────────────

    /**
     * Upload all media blobs for a project to cloud storage.
     * Reads blobs from IndexedDB, uploads via signed URLs, confirms each.
     * Skips files already uploaded. Safe to call multiple times.
     */
    static async uploadProjectMedia(projectId: string): Promise<void> {
        // Prevent duplicate concurrent uploads for same project
        if (this.activeUploads.has(projectId)) return;
        this.activeUploads.add(projectId);

        const store = useSyncStatusStore.getState();

        try {
            // Determine which media types this project has by checking blob IDs
            const mediaTypes: { fileType: MediaFileType; blobId: string }[] = [];

            const screenBlobId = `${projectId}-screen`;
            const cameraBlobId = `${projectId}-camera`;
            const micBlobId = `${projectId}-mic`;

            if (await LocalStorage.hasRecordingBlob(screenBlobId)) {
                mediaTypes.push({ fileType: 'screen', blobId: screenBlobId });
            }
            if (await LocalStorage.hasRecordingBlob(cameraBlobId)) {
                mediaTypes.push({ fileType: 'camera', blobId: cameraBlobId });
            }
            if (await LocalStorage.hasRecordingBlob(micBlobId)) {
                mediaTypes.push({ fileType: 'mic', blobId: micBlobId });
            }

            // Upload each media blob
            let uploaded = 0;
            store.setPendingMediaUploads(mediaTypes.length);

            for (const { fileType, blobId } of mediaTypes) {
                try {
                    const blob = await LocalStorage.getRecordingBlob(blobId);
                    if (!blob) {
                        console.warn(`[SyncService] Blob ${blobId} not found in IndexedDB, skipping`);
                        continue;
                    }

                    store.setCurrentUpload({ projectId, type: fileType, progress: 0 });

                    await CloudStorage.uploadMediaFile(projectId, fileType, blob, (frac) => {
                        store.setCurrentUpload({ projectId, type: fileType, progress: frac });
                    });

                    uploaded++;
                    store.setPendingMediaUploads(mediaTypes.length - uploaded);
                    console.log(`[SyncService] Uploaded ${fileType} for ${projectId}`);
                } catch (err) {
                    console.error(`[SyncService] Failed to upload ${fileType} for ${projectId}:`, err);
                    Sentry.captureException(err, { extra: { phase: 'media_upload', projectId, fileType } });
                }
            }

            store.setCurrentUpload(null);
            store.setPendingMediaUploads(0);

            // Update local syncMeta upload status
            const syncMeta = await LocalStorage.getSyncMeta(projectId);
            if (syncMeta && uploaded === mediaTypes.length) {
                await LocalStorage.saveSyncMeta({
                    ...syncMeta,
                    cloudSynced: true,
                });
            }
        } finally {
            this.activeUploads.delete(projectId);
        }
    }

    /**
     * Resume pending media uploads — called on app startup.
     * Finds projects not yet cloud-synced and re-uploads their media.
     */
    static async resumePendingUploads(): Promise<void> {
        try {
            const allSyncMeta = await LocalStorage.listSyncMeta();
            const pending = allSyncMeta.filter(m => !m.cloudSynced);

            if (pending.length === 0) return;
            console.log(`[SyncService] Resuming uploads for ${pending.length} projects`);

            for (const meta of pending) {
                this.uploadProjectMedia(meta.projectId).catch(err => {
                    console.error(`[SyncService] Resume upload failed for ${meta.projectId}:`, err);
                    Sentry.captureException(err, { extra: { phase: 'resume_upload', projectId: meta.projectId } });
                });
            }
        } catch (err) {
            console.error('[SyncService] Failed to resume pending uploads:', err);
            Sentry.captureException(err, { extra: { phase: 'resume_pending_uploads' } });
        }
    }

    /**
     * Backfill thumbnails that have never been uploaded to cloud.
     * Called on app startup alongside resumePendingUploads.
     */
    static async backfillThumbnails(): Promise<void> {
        try {
            const allSyncMeta = await LocalStorage.listSyncMeta();
            const missing = allSyncMeta.filter(m => !m.thumbnailHash);

            for (const meta of missing) {
                this.syncThumbnailToCloud(meta.projectId).catch(err => {
                    console.warn(`[SyncService] Thumbnail backfill failed for ${meta.projectId}:`, err);
                    Sentry.captureException(err, { extra: { phase: 'thumbnail_backfill', projectId: meta.projectId } });
                });
            }
        } catch (err) {
            console.error('[SyncService] Failed to backfill thumbnails:', err);
            Sentry.captureException(err, { extra: { phase: 'thumbnail_backfill_init' } });
        }
    }

    /**
     * Download all media for a cloud project and save to IndexedDB.
     * Called when user opens a project that exists in cloud but not locally.
     */
    static async downloadProjectMedia(
        projectId: string,
        cloudProject: { screen_storage_path: string | null; camera_storage_path: string | null; mic_storage_path: string | null },
        onProgress?: (type: string, fraction: number) => void,
    ): Promise<void> {
        const store = useSyncStatusStore.getState();

        const downloads: { fileType: MediaFileType; storagePath: string; blobId: string }[] = [];

        if (cloudProject.screen_storage_path && cloudProject.screen_storage_path !== 'pending') {
            downloads.push({ fileType: 'screen', storagePath: cloudProject.screen_storage_path, blobId: `${projectId}-screen` });
        }
        if (cloudProject.camera_storage_path && cloudProject.camera_storage_path !== 'pending') {
            downloads.push({ fileType: 'camera', storagePath: cloudProject.camera_storage_path, blobId: `${projectId}-camera` });
        }
        if (cloudProject.mic_storage_path && cloudProject.mic_storage_path !== 'pending') {
            downloads.push({ fileType: 'mic', storagePath: cloudProject.mic_storage_path, blobId: `${projectId}-mic` });
        }

        for (const { fileType, storagePath, blobId } of downloads) {
            // Skip if already cached locally
            if (await LocalStorage.hasRecordingBlob(blobId)) continue;

            store.setCurrentDownload({ projectId, type: fileType, progress: 0 });

            const blob = await CloudStorage.downloadMediaFile(storagePath, (frac) => {
                store.setCurrentDownload({ projectId, type: fileType, progress: frac });
                onProgress?.(fileType, frac);
            });

            await LocalStorage.saveRecordingBlob(blobId, blob);
            console.log(`[SyncService] Downloaded ${fileType} for ${projectId}`);
        }

        store.setCurrentDownload(null);
    }

    // ─── Thumbnail Sync ────────────────────────────────────────

    /**
     * Upload the local thumbnail blob to Supabase Storage if it changed.
     * Compares SHA-256 hash against the last uploaded version stored in syncMeta.
     */
    private static async syncThumbnailToCloud(projectId: string): Promise<void> {
        const blob = await LocalStorage.getThumbnail(projectId);
        if (!blob) return;

        const hash = await this.blobHash(blob);
        const syncMeta = await LocalStorage.getSyncMeta(projectId);
        if (syncMeta?.thumbnailHash === hash) return;

        await CloudStorage.uploadMediaFile(projectId, 'thumbnail', blob);

        // Update syncMeta with new hash
        if (syncMeta) {
            await LocalStorage.saveSyncMeta({ ...syncMeta, thumbnailHash: hash });
        }
    }

    private static async blobHash(blob: Blob): Promise<string> {
        const buffer = await blob.arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Download thumbnail from cloud and save to local IndexedDB.
     * No-op if local thumbnail already exists.
     */
    static async downloadThumbnailIfMissing(
        projectId: string,
        thumbnailStoragePath: string | null,
    ): Promise<void> {
        if (!thumbnailStoragePath || thumbnailStoragePath === 'pending') return;

        // Skip if we already have it locally
        const existing = await LocalStorage.getThumbnail(projectId);
        if (existing) return;

        const blob = await CloudStorage.downloadMediaFile(thumbnailStoragePath);
        await LocalStorage.saveThumbnail(projectId, blob);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private static localToListItem(project: Project): ProjectListItem {
        const windows = project.timeline?.outputWindows ?? [];
        const durationMs = windows.reduce((acc, w) => acc + (w.endMs - w.startMs), 0);
        return {
            id: project.id,
            name: project.name,
            thumbnail: project.thumbnail ?? null,
            updatedAt: project.updatedAt?.toString() ?? '',
            createdAt: project.createdAt?.toString() ?? '',
            lastAccessedAt: null,
            expiresAt: null,
            cloudSynced: false,
            cfVideoUid: null,
            cloudVersion: null,
            durationMs,
        };
    }
}
