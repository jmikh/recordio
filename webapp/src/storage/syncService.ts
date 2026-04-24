import type { Project, ID } from '../types';
import { ProjectStorage } from './projectStorage';
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
    uploadStatus: string | null;
    cfVideoUid: string | null;
    cloudVersion: number | null;
    /** Whether this project exists locally (in IndexedDB) */
    hasLocal: boolean;
    /** Whether this project exists in the cloud */
    hasCloud: boolean;
}

// Cloud sync debounce (30 seconds)
const CLOUD_SYNC_DEBOUNCE_MS = 30_000;

/**
 * SyncService — orchestrates IndexedDB ↔ cloud sync for project metadata + media.
 *
 * Usage:
 *   - Auto-save subscriber calls `SyncService.saveProject()` instead of `ProjectStorage.saveProject()`.
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
     * Save project to IndexedDB (fast) + queue cloud sync (debounced).
     * Replaces direct `ProjectStorage.saveProject()` calls in auto-save.
     */
    static async saveProject(project: Project, userId: string | null, isPro: boolean): Promise<void> {
        // 1. Always save locally first (fast path)
        await ProjectStorage.saveProject(project);

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
     */
    private static async syncProjectToCloud(project: Project, userId: string, isPro: boolean): Promise<void> {
        const store = useSyncStatusStore.getState();
        store.setSyncing();

        try {
            const syncMeta = await ProjectStorage.getSyncMeta(project.id);
            const expectedVersion = syncMeta?.cloudVersion;

            const result = await CloudStorage.saveProjectMetadata(
                project,
                userId,
                expectedVersion,
                isPro,
            );

            // Update local sync metadata
            await ProjectStorage.saveSyncMeta({
                projectId: project.id,
                userId,
                cloudId: project.id,
                cloudVersion: result.cloudVersion,
                uploadStatus: syncMeta?.uploadStatus ?? 'pending',
                lastSyncedAt: Date.now(),
            });

            store.setLastSyncedAt(new Date());
            store.setIdle();
        } catch (err) {
            if (err instanceof CloudVersionConflictError) {
                store.setConflict({ projectId: err.projectId, projectName: project.name });
                store.setIdle();
            } else {
                console.error('[SyncService] Cloud sync failed:', err);
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
    static async listProjects(userId: string | null): Promise<ProjectListItem[]> {
        const localProjects = await ProjectStorage.listProjects();
        const localMap = new Map(localProjects.map(p => [p.id, p]));

        // If not authenticated, show all local projects
        if (!userId) {
            return localProjects.map(p => this.localToListItem(p));
        }

        // Fetch cloud projects
        let cloudProjects: CloudProjectSummary[] = [];
        try {
            cloudProjects = await CloudStorage.listProjectsSummary();
        } catch (err) {
            console.error('[SyncService] Failed to fetch cloud projects:', err);
        }

        const result: ProjectListItem[] = [];
        const seen = new Set<string>();

        // 1. Cloud projects — attach local data (thumbnail) if available
        for (const cloud of cloudProjects) {
            seen.add(cloud.id);
            const local = localMap.get(cloud.id);
            result.push({
                id: cloud.id,
                name: cloud.name,
                thumbnail: local?.thumbnail ?? null,
                updatedAt: cloud.updated_at,
                createdAt: cloud.created_at,
                lastAccessedAt: cloud.last_accessed_at,
                expiresAt: cloud.expires_at,
                uploadStatus: cloud.upload_status,
                cfVideoUid: cloud.cf_video_uid,
                cloudVersion: cloud.cloud_version,
                hasLocal: !!local,
                hasCloud: true,
            });
        }

        // 2. Local-only projects (not yet synced to cloud)
        for (const local of localProjects) {
            if (!seen.has(local.id)) {
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

            await ProjectStorage.saveSyncMeta({
                projectId: project.id,
                userId,
                cloudId: project.id,
                cloudVersion: result.cloudVersion,
                uploadStatus: 'pending',
                lastSyncedAt: Date.now(),
            });

            // Queue media uploads in background (non-blocking)
            this.uploadProjectMedia(project.id).catch(err => {
                console.error(`[SyncService] Background media upload failed for ${project.id}:`, err);
            });
        } catch (err) {
            console.error('[SyncService] Failed to create cloud project:', err);
            // Non-fatal — project is saved locally, cloud sync will retry
        }
    }

    /**
     * Called on login — syncs local projects to cloud.
     * Uploads metadata for any local projects that don't have syncMeta.
     */
    static async onLogin(userId: string, isPro: boolean): Promise<void> {
        const localProjects = await ProjectStorage.listProjects();
        const allSyncMeta = await ProjectStorage.listSyncMeta();
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
        }

        // Local delete
        await ProjectStorage.deleteProject(projectId);
    }

    /**
     * Resolve a version conflict by reloading cloud data (discard local).
     */
    static async resolveConflictReload(projectId: string): Promise<Project | null> {
        const cloudProject = await CloudStorage.loadProjectMetadata(projectId);
        if (!cloudProject) return null;

        const project = cloudProject.project_data as Project;
        project.id = projectId;
        await ProjectStorage.saveProject(project);

        const syncMeta = await ProjectStorage.getSyncMeta(projectId);
        await ProjectStorage.saveSyncMeta({
            projectId,
            userId: syncMeta?.userId ?? '',
            cloudId: projectId,
            cloudVersion: cloudProject.cloud_version,
            uploadStatus: syncMeta?.uploadStatus ?? 'pending',
            lastSyncedAt: Date.now(),
        });

        useSyncStatusStore.getState().clearConflict();
        return project;
    }

    /**
     * Resolve a version conflict by force-pushing local version to cloud.
     */
    static async resolveConflictForce(
        project: Project,
        userId: string,
        isPro: boolean,
    ): Promise<void> {
        const cloudProject = await CloudStorage.loadProjectMetadata(project.id);
        if (!cloudProject) return;

        const result = await CloudStorage.saveProjectMetadata(
            project,
            userId,
            cloudProject.cloud_version,
            isPro,
        );

        const syncMeta = await ProjectStorage.getSyncMeta(project.id);
        await ProjectStorage.saveSyncMeta({
            projectId: project.id,
            userId,
            cloudId: project.id,
            cloudVersion: result.cloudVersion,
            uploadStatus: syncMeta?.uploadStatus ?? 'pending',
            lastSyncedAt: Date.now(),
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

            if (await ProjectStorage.hasRecordingBlob(screenBlobId)) {
                mediaTypes.push({ fileType: 'screen', blobId: screenBlobId });
            }
            if (await ProjectStorage.hasRecordingBlob(cameraBlobId)) {
                mediaTypes.push({ fileType: 'camera', blobId: cameraBlobId });
            }
            if (await ProjectStorage.hasRecordingBlob(micBlobId)) {
                mediaTypes.push({ fileType: 'mic', blobId: micBlobId });
            }

            // Also upload thumbnail if present
            const project = await ProjectStorage.loadProject(projectId);
            if (project?.thumbnail) {
                // Thumbnail is a data URL — convert to blob
                const thumbBlob = await this.dataUrlToBlob(project.thumbnail);
                if (thumbBlob) {
                    try {
                        store.setCurrentUpload({ projectId, type: 'thumbnail', progress: 0 });
                        await CloudStorage.uploadMediaFile(projectId, 'thumbnail', thumbBlob, (frac) => {
                            store.setCurrentUpload({ projectId, type: 'thumbnail', progress: frac });
                        });
                        console.log(`[SyncService] Uploaded thumbnail for ${projectId}`);
                    } catch (err) {
                        console.error(`[SyncService] Thumbnail upload failed for ${projectId}:`, err);
                    }
                }
            }

            // Upload each media blob
            let uploaded = 0;
            store.setPendingMediaUploads(mediaTypes.length);

            for (const { fileType, blobId } of mediaTypes) {
                try {
                    const blob = await ProjectStorage.getRecordingBlob(blobId);
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
                    // Continue with other files — partial upload is better than none
                }
            }

            store.setCurrentUpload(null);
            store.setPendingMediaUploads(0);

            // Update local syncMeta upload status
            const syncMeta = await ProjectStorage.getSyncMeta(projectId);
            if (syncMeta && uploaded === mediaTypes.length) {
                await ProjectStorage.saveSyncMeta({
                    ...syncMeta,
                    uploadStatus: 'ready',
                });
            }
        } finally {
            this.activeUploads.delete(projectId);
        }
    }

    /**
     * Resume pending media uploads — called on app startup.
     * Finds projects with upload_status = 'pending' in cloud and re-uploads missing media.
     */
    static async resumePendingUploads(): Promise<void> {
        try {
            const allSyncMeta = await ProjectStorage.listSyncMeta();
            const pending = allSyncMeta.filter(m => m.uploadStatus === 'pending');

            if (pending.length === 0) return;
            console.log(`[SyncService] Resuming uploads for ${pending.length} projects`);

            for (const meta of pending) {
                this.uploadProjectMedia(meta.projectId).catch(err => {
                    console.error(`[SyncService] Resume upload failed for ${meta.projectId}:`, err);
                });
            }
        } catch (err) {
            console.error('[SyncService] Failed to resume pending uploads:', err);
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
            if (await ProjectStorage.hasRecordingBlob(blobId)) continue;

            store.setCurrentDownload({ projectId, type: fileType, progress: 0 });

            const blob = await CloudStorage.downloadMediaFile(storagePath, (frac) => {
                store.setCurrentDownload({ projectId, type: fileType, progress: frac });
                onProgress?.(fileType, frac);
            });

            await ProjectStorage.saveRecordingBlob(blobId, blob);
            console.log(`[SyncService] Downloaded ${fileType} for ${projectId}`);
        }

        store.setCurrentDownload(null);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private static async dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
        try {
            const response = await fetch(dataUrl);
            return response.blob();
        } catch {
            return null;
        }
    }

    private static localToListItem(project: Project): ProjectListItem {
        return {
            id: project.id,
            name: project.name,
            thumbnail: project.thumbnail ?? null,
            updatedAt: project.updatedAt?.toString() ?? '',
            createdAt: project.createdAt?.toString() ?? '',
            lastAccessedAt: null,
            expiresAt: null,
            uploadStatus: null,
            cfVideoUid: null,
            cloudVersion: null,
            hasLocal: true,
            hasCloud: false,
        };
    }
}
