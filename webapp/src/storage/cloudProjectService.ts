import type { Project, ID } from '@shared/types';
import type { RawRecording } from '@shared/types';
import * as Sentry from '@sentry/react';
import { captureError } from '../utils/sentry';
import { CloudStorage, CloudVersionConflictError, type CloudProjectSummary, type CloudFolder } from './cloudStorage';
import { BlobCache } from './blobCache';
import { useSyncStatusStore } from './syncStatusStore';
import { useMediaUrlStore } from '../editor/stores/useMediaUrlStore';
import { migrateProject } from '../core/migrateProject';
import { ProjectImpl } from '../core/Project';
import { cloudStoragePath, hydrateMediaUrls } from './projectBlobs';

// ─── Types ───────────────────────────────────────────────────

/**
 * Item in the cloud project list for dashboard display.
 */
export interface ProjectListItem {
    id: string;
    name: string;
    thumbnail: string | null;
    thumbnailStoragePath: string | null;
    updatedAt: string;
    createdAt: string;
    lastAccessedAt: string | null;
    expiresAt: string | null;
    /** ISO date when the project was soft-deleted (null = active) */
    deletedAt: string | null;
    isShared: boolean;
    cloudVersion: number | null;
    /** Duration in milliseconds (from output windows) */
    durationMs: number | null;
    /** Share slug for public video link (null if not shared) */
    shareSlug: string | null;
    /** Folder this project belongs to (null = unfiled) */
    folderId: string | null;
    /** Whether the project is starred/favorited */
    isStarred: boolean;
}

// ─── Service ─────────────────────────────────────────────────

/**
 * CloudProjectService — cloud-only project operations.
 *
 * Cloud (Supabase) is the sole source of truth for project metadata and media.
 * Each media source stores its cloud storage path in `storagePath` on the project
 * struct. Transient blob URLs for playback live in useMediaUrlStore.
 * The Cache API provides local blob caching via BlobCache.
 */
export class CloudProjectService {
    /** In-memory cloud version tracking (replaces IndexedDB syncMeta). */
    private static cloudVersions = new Map<string, number>();

    /** Get the last-known cloud version for a project. */
    static getCloudVersion(projectId: string): number | undefined {
        return this.cloudVersions.get(projectId);
    }
    /** In-memory project data hash — skip no-op cloud writes. */
    private static projectHashes = new Map<string, string>();
    /** Guard against concurrent saves for the same project. */
    private static saveInFlight = new Set<string>();
    /** In-memory hash of last uploaded thumbnail per project. */
    private static thumbnailHashes = new Map<string, string>();

    // ─── Hash ────────────────────────────────────────────────

    /**
     * SHA-256 hash of cloud-serializable project data.
     * Skips no-op writes to avoid unnecessary cloud_version bumps.
     */
    private static async projectDataHash(project: Project): Promise<string> {
        const { userEvents, ...rest } = project as any;
        const json = JSON.stringify(rest);
        const buffer = new TextEncoder().encode(json);
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ─── Import ──────────────────────────────────────────────

    /**
     * Fast local import: build the project struct, send it to `project-create`
     * which generates storage paths, saves to DB with upload_status='pending',
     * and returns signed upload URLs. Then cache blobs locally for immediate
     * playback. Call uploadMedia() separately to push blobs to cloud.
     *
     * Returns the project (with server-stamped storagePaths) and the signed
     * upload URLs needed by uploadMedia().
     */
    static async importRecordingLocal(
        recording: RawRecording,
        screenBlob: Blob,
        workspaceId: string,
        cameraBlob?: Blob,
        micBlob?: Blob,
    ): Promise<{ project: Project; name: string; uploads: { fileType: string; storagePath: string; signedUrl: string; token: string }[] }> {
        const projectId = recording.id;

        // 1. Build project struct (storagePaths left as placeholders — server stamps real ones)
        const screenSource = { ...recording.screenSource, storagePath: '' };
        const cameraSource = recording.cameraSource && cameraBlob
            ? { ...recording.cameraSource, storagePath: '' }
            : undefined;
        const microphoneSource = recording.microphoneSource && micBlob
            ? { ...recording.microphoneSource, storagePath: '' }
            : undefined;

        const project = ProjectImpl.createFromSource(
            projectId, screenSource, recording.userEvents,
            cameraSource, microphoneSource,
        );

        // Compute name (truncated to 40 chars) — stored as DB column, not in project_data
        let name = recording.name || 'New Project';
        if (name.length > 40) name = name.substring(0, 37) + '...';

        // 2. Send to server — stamps storagePaths, saves with upload_status='pending', returns signed URLs
        const { uploads } = await CloudStorage.createProject(project, name, workspaceId);

        // 3. Update local project struct with server-generated storagePaths
        const pathMap = new Map(uploads.map(u => [u.fileType, u.storagePath]));
        if (pathMap.has('screen')) project.screenSource.storagePath = pathMap.get('screen')!;
        if (pathMap.has('camera') && project.cameraSource) project.cameraSource.storagePath = pathMap.get('camera')!;
        if (pathMap.has('mic') && project.microphoneSource) project.microphoneSource.storagePath = pathMap.get('mic')!;

        // 4. Cache blobs locally + populate media URL store for immediate playback
        const { setUrl } = useMediaUrlStore.getState();
        await BlobCache.put(project.screenSource.storagePath, screenBlob);
        setUrl(project.screenSource.storagePath, URL.createObjectURL(screenBlob));
        if (project.cameraSource && cameraBlob) {
            await BlobCache.put(project.cameraSource.storagePath, cameraBlob);
            setUrl(project.cameraSource.storagePath, URL.createObjectURL(cameraBlob));
        }
        if (project.microphoneSource && micBlob) {
            await BlobCache.put(project.microphoneSource.storagePath, micBlob);
            setUrl(project.microphoneSource.storagePath, URL.createObjectURL(micBlob));
        }

        // 5. Set baseline hash so auto-save doesn't trigger a no-op write
        const hash = await this.projectDataHash(project);
        this.projectHashes.set(projectId, hash);

        return { project, name, uploads };
    }

    /**
     * Upload media blobs to cloud storage using pre-obtained signed URLs.
     * Runs in background after editor opens. Updates syncStatusStore
     * with progress. On completion, calls project_confirm_upload RPC.
     *
     * @param uploads - Signed upload URLs from importRecordingLocal()
     * @param maxRetries - Number of full-upload retries (TUS handles chunk-level retries internally)
     */
    static async uploadMedia(
        projectId: string,
        uploads: { fileType: string; storagePath: string; signedUrl: string; token: string }[],
        blobs: { fileType: string; blob: Blob }[],
        onProgress?: (phase: string, fraction: number) => void,
        maxRetries = 3,
    ): Promise<void> {
        const store = useSyncStatusStore.getState();
        store.setPendingMediaUploads(blobs.length);

        // Index uploads by fileType
        const uploadMap = new Map(uploads.map(u => [u.fileType, u]));

        const MIME_MAP: Record<string, string> = {
            screen: 'video/webm',
            camera: 'video/webm',
            mic: 'audio/wav',
        };

        // Track per-file progress for parallel uploads
        const progressMap = new Map<string, number>();
        const updateAggregateProgress = () => {
            const values = [...progressMap.values()];
            const minProgress = Math.min(...values);
            store.setCurrentUpload({ projectId, type: 'media', progress: minProgress });
        };

        const uploadAndCache = async (fileType: string, blob: Blob) => {
            const uploadInfo = uploadMap.get(fileType);
            if (!uploadInfo) throw new Error(`No upload URL for ${fileType}`);

            progressMap.set(fileType, 0);
            updateAggregateProgress();

            let lastError: Error | null = null;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    await CloudStorage.uploadBlob(uploadInfo.signedUrl, blob, MIME_MAP[fileType] ?? 'application/octet-stream', (frac) => {
                        progressMap.set(fileType, frac);
                        updateAggregateProgress();
                        onProgress?.(fileType, frac);
                    });

                    await BlobCache.put(uploadInfo.storagePath, blob);
                    progressMap.set(fileType, 1);
                    updateAggregateProgress();
                    const current = useSyncStatusStore.getState();
                    current.setPendingMediaUploads(current.pendingMediaUploads - 1);
                    return;
                } catch (e) {
                    lastError = e instanceof Error ? e : new Error(String(e));
                    console.error(`[CloudProjectService] Upload ${fileType} attempt ${attempt + 1}/${maxRetries} failed:`, e);
                }
            }
            throw lastError!;
        };

        try {
            await Promise.all(blobs.map(({ fileType, blob }) => uploadAndCache(fileType, blob)));

            // All uploads complete — confirm via RPC
            await CloudStorage.confirmProjectUpload(projectId);
            store.setPendingMediaUploads(0);
            store.setCurrentUpload(null);
            store.setLastSyncedAt(new Date());
            store.setIdle();
        } catch (e) {
            console.error('[CloudProjectService] Media upload failed after retries:', e);
            Sentry.captureException(e, { extra: { phase: 'media_upload', projectId } });
            store.setCurrentUpload(null);
            store.setError(e instanceof Error ? e.message : 'Media upload failed');
            throw e;
        }
    }

    // ─── Import / Upload (v2 — TUS resumable) ────────────────

    /**
     * v2 of importRecordingLocal — uses the project-create-v2 edge function,
     * which does not return signed URLs. Upload is done via TUS resumable
     * (chunked) so per-chunk retries are handled by tus-js-client and a
     * single transient failure doesn't fail the whole upload.
     */
    static async importRecordingLocalV2(
        recording: RawRecording,
        screenBlob: Blob,
        workspaceId: string,
        cameraBlob?: Blob,
        micBlob?: Blob,
    ): Promise<{ project: Project; name: string; bucket: string; uploads: { fileType: string; storagePath: string }[] }> {
        const projectId = recording.id;

        const screenSource = { ...recording.screenSource, storagePath: '' };
        const cameraSource = recording.cameraSource && cameraBlob
            ? { ...recording.cameraSource, storagePath: '' }
            : undefined;
        const microphoneSource = recording.microphoneSource && micBlob
            ? { ...recording.microphoneSource, storagePath: '' }
            : undefined;

        const project = ProjectImpl.createFromSource(
            projectId, screenSource, recording.userEvents,
            cameraSource, microphoneSource,
        );

        let name = recording.name || 'New Project';
        if (name.length > 40) name = name.substring(0, 37) + '...';

        const { bucket, uploads } = await CloudStorage.createProjectV2(project, name, workspaceId);

        const pathMap = new Map(uploads.map(u => [u.fileType, u.storagePath]));
        if (pathMap.has('screen')) project.screenSource.storagePath = pathMap.get('screen')!;
        if (pathMap.has('camera') && project.cameraSource) project.cameraSource.storagePath = pathMap.get('camera')!;
        if (pathMap.has('mic') && project.microphoneSource) project.microphoneSource.storagePath = pathMap.get('mic')!;

        const { setUrl } = useMediaUrlStore.getState();
        await BlobCache.put(project.screenSource.storagePath, screenBlob);
        setUrl(project.screenSource.storagePath, URL.createObjectURL(screenBlob));
        if (project.cameraSource && cameraBlob) {
            await BlobCache.put(project.cameraSource.storagePath, cameraBlob);
            setUrl(project.cameraSource.storagePath, URL.createObjectURL(cameraBlob));
        }
        if (project.microphoneSource && micBlob) {
            await BlobCache.put(project.microphoneSource.storagePath, micBlob);
            setUrl(project.microphoneSource.storagePath, URL.createObjectURL(micBlob));
        }

        const hash = await this.projectDataHash(project);
        this.projectHashes.set(projectId, hash);

        return { project, name, bucket, uploads };
    }

    /**
     * v2: Upload media blobs via TUS resumable upload. tus-js-client handles
     * chunk-level retry and resumption internally, so the outer retry loop
     * only guards against catastrophic failures (e.g. expired token).
     * Confirms the project via the existing project_confirm_upload RPC once
     * all files are done.
     */
    static async uploadMediaV2(
        projectId: string,
        bucket: string,
        uploads: { fileType: string; storagePath: string }[],
        blobs: { fileType: string; blob: Blob }[],
        onProgress?: (phase: string, fraction: number) => void,
        maxRetries = 2,
    ): Promise<void> {
        const store = useSyncStatusStore.getState();
        store.setPendingMediaUploads(blobs.length);

        const uploadMap = new Map(uploads.map(u => [u.fileType, u]));

        const MIME_MAP: Record<string, string> = {
            screen: 'video/webm',
            camera: 'video/webm',
            mic: 'audio/wav',
        };

        // Bytes-weighted aggregate: sum(loaded) / sum(total) across all files.
        const totalBytes = blobs.reduce((sum, { blob }) => sum + blob.size, 0);
        const loadedMap = new Map<string, number>();
        const updateAggregateProgress = () => {
            let loaded = 0;
            for (const v of loadedMap.values()) loaded += v;
            const fraction = totalBytes > 0 ? Math.min(1, loaded / totalBytes) : 0;
            store.setCurrentUpload({ projectId, type: 'media', progress: fraction });
        };

        const uploadAndCache = async (fileType: string, blob: Blob) => {
            const uploadInfo = uploadMap.get(fileType);
            if (!uploadInfo) throw new Error(`No upload info for ${fileType}`);

            loadedMap.set(fileType, 0);
            updateAggregateProgress();

            let lastError: Error | null = null;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    await CloudStorage.uploadBlobResumable(
                        bucket,
                        uploadInfo.storagePath,
                        blob,
                        MIME_MAP[fileType] ?? 'application/octet-stream',
                        (frac) => {
                            loadedMap.set(fileType, frac * blob.size);
                            updateAggregateProgress();
                            onProgress?.(fileType, frac);
                        },
                    );

                    await BlobCache.put(uploadInfo.storagePath, blob);
                    loadedMap.set(fileType, blob.size);
                    updateAggregateProgress();
                    const current = useSyncStatusStore.getState();
                    current.setPendingMediaUploads(current.pendingMediaUploads - 1);
                    return;
                } catch (e) {
                    lastError = e instanceof Error ? e : new Error(String(e));
                    console.error(`[CloudProjectService] Upload ${fileType} attempt ${attempt + 1}/${maxRetries} failed:`, e);
                }
            }
            throw lastError!;
        };

        try {
            await Promise.all(blobs.map(({ fileType, blob }) => uploadAndCache(fileType, blob)));

            await CloudStorage.confirmProjectUpload(projectId);
            store.setPendingMediaUploads(0);
            store.setCurrentUpload(null);
            store.setLastSyncedAt(new Date());
            store.setIdle();
        } catch (e) {
            console.error('[CloudProjectService] Media upload (v2) failed after retries:', e);
            Sentry.captureException(e, { extra: { phase: 'media_upload_v2', projectId } });
            store.setCurrentUpload(null);
            store.setError(e instanceof Error ? e.message : 'Media upload failed');
            throw e;
        }
    }

    // ─── Load ────────────────────────────────────────────────

    /**
     * Load a project from cloud and hydrate blob URLs from cache
     * (downloads from cloud on cache miss).
     *
     * Backfills storagePath on sources for pre-v5 projects using the
     * deterministic path pattern. Blob URLs go to useMediaUrlStore.
     */
    static async loadProject(
        projectId: string,
        onStatus?: (status: string) => void,
    ): Promise<{ project: Project; name: string } | null> {
        onStatus?.('Loading project...');
        console.log('[CloudProjectService.loadProject] Loading project:', projectId);
        const cloudProject = await CloudStorage.loadProjectMetadata(projectId);
        if (!cloudProject) {
            console.error('[CloudProjectService.loadProject] loadProjectMetadata returned null — project_get returned NULL. Possible auth.uid() mismatch.');
            return null;
        }
        console.log('[CloudProjectService.loadProject] Got metadata:', { upload_status: cloudProject.upload_status, cloud_version: cloudProject.cloud_version, user_id: cloudProject.user_id });

        // Projects only ever reach the editor after ImportPage has fully
        // uploaded media and confirmed upload_status='ready'. A 'pending'
        // status here means an old, orphaned project — reject it.
        if (cloudProject.upload_status !== 'ready') {
            console.log('[CloudProjectService.loadProject] Rejecting project with non-ready upload_status:', cloudProject.upload_status);
            return null;
        }

        const rawProject = cloudProject.project_data as Project;
        rawProject.id = projectId;

        const project = { ...migrateProject(rawProject) };

        this.cloudVersions.set(projectId, cloudProject.cloud_version);

        // Backfill storagePath on sources for pre-v5 projects
        const userId = cloudProject.user_id;
        if (!project.screenSource.storagePath) {
            project.screenSource.storagePath = cloudStoragePath(userId, projectId, 'screen');
        }
        if (project.cameraSource && !project.cameraSource.storagePath) {
            project.cameraSource.storagePath = cloudStoragePath(userId, projectId, 'camera');
        }
        if (project.microphoneSource && !project.microphoneSource.storagePath) {
            project.microphoneSource.storagePath = cloudStoragePath(userId, projectId, 'mic');
        }

        // Hydrate media URLs into the media URL store (download on cache miss).
        // getProjectMediaPaths() now includes background/music storagePaths,
        // so custom assets are hydrated automatically alongside screen/camera/mic.
        const { setUrl } = useMediaUrlStore.getState();
        await hydrateMediaUrls(project, setUrl, onStatus);

        // Set baseline hash
        const hash = await this.projectDataHash(project);
        this.projectHashes.set(projectId, hash);

        return { project, name: cloudProject.name };
    }

    // ─── Save ────────────────────────────────────────────────

    /**
     * Save project metadata to cloud. Skips no-op writes by comparing
     * SHA-256 hash of the cloud-serializable data. Uses optimistic
     * concurrency via cloud_version to detect conflicts.
     *
     * Skipping unchanged saves prevents unnecessary cloud_version bumps
     * which are used downstream to avoid redundant re-renders.
     */
    static async saveProject(project: Project, userId: string): Promise<void> {
        const projectId = project.id;

        // Hold saves while media is still uploading — edits buffer locally
        // and flush when uploadMedia() completes
        const { pendingMediaUploads } = useSyncStatusStore.getState();
        if (pendingMediaUploads > 0) return;

        // Skip if a save is already in flight
        if (this.saveInFlight.has(projectId)) return;

        // Skip if project data hasn't changed
        const hash = await this.projectDataHash(project);
        if (this.projectHashes.get(projectId) === hash) return;

        this.saveInFlight.add(projectId);
        const store = useSyncStatusStore.getState();
        store.setSyncing();

        try {
            const expectedVersion = this.cloudVersions.get(projectId);
            console.log('[CloudProjectService.saveProject] Saving project:', projectId, 'expectedVersion:', expectedVersion);
            const result = await CloudStorage.saveProjectMetadata(
                project, userId, expectedVersion,
            );

            console.log('[CloudProjectService.saveProject] Save success, new cloudVersion:', result.cloudVersion);
            this.cloudVersions.set(projectId, result.cloudVersion);
            this.projectHashes.set(projectId, hash);
            store.setLastSyncedAt(new Date());
            store.setIdle();
        } catch (err) {
            if (err instanceof CloudVersionConflictError) {
                console.error('[CloudProjectService.saveProject] VERSION CONFLICT! projectId:', err.projectId, 'expectedVersion:', err.expectedVersion);
                store.setConflict({ projectId: err.projectId });
                store.setIdle();
            } else {
                console.error('[CloudProjectService] Save failed:', err);
                Sentry.captureException(err, { extra: { phase: 'save_project', projectId } });
                store.setError(err instanceof Error ? err.message : 'Save failed');
            }
        } finally {
            this.saveInFlight.delete(projectId);
        }
    }

    // ─── List ────────────────────────────────────────────────

    /**
     * List projects from cloud. Thumbnails are loaded from cache
     * or downloaded in the background.
     */
    static async listProjects(workspaceId: string): Promise<ProjectListItem[]> {
        const summaries = await CloudStorage.listProjectsSummary(workspaceId);

        return summaries.map((s: CloudProjectSummary) => ({
            id: s.id,
            name: s.name,
            thumbnail: null,
            thumbnailStoragePath: s.thumbnail_storage_path,
            updatedAt: s.updated_at,
            createdAt: s.created_at,
            lastAccessedAt: s.last_accessed_at,
            expiresAt: s.expires_at,
            deletedAt: s.deleted_at,
            isShared: s.is_shared,
            cloudVersion: s.cloud_version,
            durationMs: s.duration_ms,
            shareSlug: s.slug,
            folderId: s.folder_id,
            isStarred: s.is_starred,
        }));
    }

    /**
     * Load thumbnails for a list of projects in the background.
     * Call this AFTER setting the projects in state to avoid race conditions.
     * Batches all signed URL requests into a single edge function call.
     */
    static loadThumbnails(
        items: ProjectListItem[],
        onThumbnailLoaded: (projectId: string, thumbnailUrl: string) => void,
    ): void {
        const withThumbnails = items.filter(
            (item) => item.thumbnailStoragePath && item.thumbnailStoragePath !== 'pending',
        );
        if (withThumbnails.length === 0) return;

        const paths = withThumbnails.map((item) => item.thumbnailStoragePath!);

        BlobCache.getBlobUrls(paths)
            .then((blobUrls) => {
                for (const item of withThumbnails) {
                    const url = blobUrls[item.thumbnailStoragePath!];
                    if (url) onThumbnailLoaded(item.id, url);
                }
            })
            .catch(err => captureError(err, { flow: 'thumbnail_batch_load' }));
    }

    // ─── Delete ──────────────────────────────────────────────

    static async deleteProject(projectId: ID): Promise<void> {
        try {
            await CloudStorage.softDeleteProject(projectId);
        } catch (err) {
            console.error('[CloudProjectService] Delete failed:', err);
            Sentry.captureException(err, { extra: { phase: 'delete_project', projectId } });
        }

        this.cloudVersions.delete(projectId);
        this.projectHashes.delete(projectId);
    }

    // ─── Restore ─────────────────────────────────────────────

    static async restoreProject(projectId: string): Promise<boolean> {
        try {
            return await CloudStorage.restoreProject(projectId);
        } catch (err) {
            console.error('[CloudProjectService] Restore failed:', err);
            Sentry.captureException(err, { extra: { phase: 'restore_project', projectId } });
            return false;
        }
    }

    // ─── Conflict Resolution ─────────────────────────────────

    /**
     * Discard local edits and reload the cloud version.
     */
    static async resolveConflictReload(projectId: string): Promise<{ project: Project; name: string } | null> {
        const result = await this.loadProject(projectId);
        useSyncStatusStore.getState().clearConflict();
        return result;
    }

    /**
     * Force-push local version to cloud (overwrites cloud version).
     */
    static async resolveConflictForce(
        project: Project,
        userId: string,
    ): Promise<void> {
        const cloudVersion = await CloudStorage.getCloudVersion(project.id);
        if (cloudVersion === null) return;

        const result = await CloudStorage.saveProjectMetadata(
            project, userId, cloudVersion,
        );

        const hash = await this.projectDataHash(project);
        this.cloudVersions.set(project.id, result.cloudVersion);
        this.projectHashes.set(project.id, hash);

        useSyncStatusStore.getState().clearConflict();
    }

    // ─── Thumbnails ──────────────────────────────────────────

    /**
     * Save a thumbnail: cache locally + upload to cloud.
     * Skips upload if the blob hash matches the last uploaded version.
     */
    static async saveThumbnail(projectId: string, blob: Blob): Promise<void> {
        const buffer = await blob.arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
        const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

        if (this.thumbnailHashes.get(projectId) === hash) return;

        // Cache locally for dashboard display
        const storagePath = `${projectId}/thumbnail.webp`;
        await BlobCache.put(storagePath, blob);

        // Upload to cloud (non-blocking)
        CloudStorage.uploadThumbnail(projectId, blob)
            .then(() => { this.thumbnailHashes.set(projectId, hash); })
            .catch(err => captureError(err, { flow: 'thumbnail_upload', projectId }));
    }

    // ─── Folders ─────────────────────────────────────────────

    static async listFolders(workspaceId: string): Promise<CloudFolder[]> {
        return CloudStorage.listFolders(workspaceId);
    }

    static async createFolder(name: string, workspaceId: string, description = ''): Promise<CloudFolder> {
        return CloudStorage.createFolder(name, workspaceId, description);
    }

    static async updateFolder(folderId: string, name: string, description: string): Promise<CloudFolder | null> {
        return CloudStorage.updateFolder(folderId, name, description);
    }

    static async deleteFolder(folderId: string): Promise<boolean> {
        return CloudStorage.deleteFolder(folderId);
    }

    static async moveProjectToFolder(projectId: string, folderId: string | null): Promise<boolean> {
        return CloudStorage.moveProjectToFolder(projectId, folderId);
    }

    // ─── Star ────────────────────────────────────────────────────

    static async starProject(projectId: string, starred: boolean): Promise<void> {
        await CloudStorage.starProject(projectId, starred);
    }

    // ─── Rename ──────────────────────────────────────────────────

    static async renameProject(projectId: string, name: string): Promise<void> {
        await CloudStorage.renameProject(projectId, name);
    }
}
