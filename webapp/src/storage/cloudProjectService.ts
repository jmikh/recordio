import type { Project, ID } from '@shared/types';
import type { RawRecording } from '@shared/types';
import * as Sentry from '@sentry/react';
import { captureError } from '../lib/sentry';
import { CloudStorage, CloudVersionConflictError } from './cloudStorage';
import type { AccessRole, CloudProject, CloudProjectSummary, ProjectEditor, SharePolicy } from '@shared/api';
import { BlobCache } from './blobCache';
import { useSyncStatusStore } from './syncStatusStore';
import { useActivityStore, uploadTaskId } from '../activity/useActivityStore';
import { useMediaUrlStore } from './useMediaUrlStore';
import { migrateProject } from '../core/migrateProject';
import { ProjectImpl } from '../core/Project';
import { adaptDefaultsToSources } from '../core/projectDefaults';
import type { ProjectSettings } from '@shared/types/settings';
import { cloudStoragePath, hydrateMediaUrls } from './projectBlobs';
import { dataHash } from './dataHash';

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
    /** Current owner — the free-plan project cap counts by owner (Step 4) */
    ownerId: string;
    /** ISO date when the project was soft-deleted (null = active) */
    deletedAt: string | null;
    isShared: boolean;
    cloudVersion: number | null;
    /** Duration in milliseconds (from output windows) */
    durationMs: number | null;
    /** Permanent share slug (share-access model: every project has one) */
    shareSlug: string | null;
    /** Share visibility ('private' = draft) */
    sharePolicy: SharePolicy | null;
    /** What workspace members get when the policy is workspace/public */
    workspaceAccess: AccessRole | null;
    /** Whether the project is shared with the caller via project_editors */
    isEditor: boolean;
    /** The caller's individual grant role (null = none) */
    editorRole: AccessRole | null;
    /**
     * 'pending' = the recording never finished uploading. Only the owner's
     * own pending projects are listed, and only when every media file is
     * still in this browser's BlobCache (see listProjects).
     */
    uploadStatus: 'pending' | 'ready';
    /** Pending rows only: the media the upload has to resume with */
    mediaPaths: { storagePath: string; type: 'screen' | 'camera' | 'mic' }[] | null;
}

/** Share-relevant metadata returned alongside a loaded project. */
export interface ProjectShareMeta {
    id: string;
    ownerId: string;
    workspaceId: string | null;
    slug: string;
    sharePolicy: SharePolicy;
    workspaceAccess: AccessRole;
    editors: ProjectEditor[];
    ownerName: string | null;
    ownerEmail: string;
    /** Version the mux publish targets when the editor isn't tracking a live one */
    cloudVersion: number;
}

/** ShareModal's slice of a project-get response (used by editor load + dashboard card menu). */
export function toShareMeta(cloudProject: CloudProject): ProjectShareMeta {
    return {
        id: cloudProject.id,
        ownerId: cloudProject.owner_id,
        workspaceId: cloudProject.workspace_id,
        slug: cloudProject.slug,
        sharePolicy: cloudProject.share_policy,
        workspaceAccess: cloudProject.workspace_access,
        editors: cloudProject.editors,
        ownerName: cloudProject.owner_name,
        ownerEmail: cloudProject.owner_email,
        cloudVersion: cloudProject.cloud_version,
    };
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
    /** Active media upload promises keyed by projectId. Used to dedupe + allow `pending` editor loads. */
    private static activeUploads = new Map<string, Promise<void>>();

    /** Whether a media upload is currently running for this project (in this tab). */
    static isUploadActive(projectId: string): boolean {
        return this.activeUploads.has(projectId);
    }

    // ─── Hash ────────────────────────────────────────────────

    /**
     * SHA-256 hash of cloud-serializable project data.
     * Skips no-op writes to avoid unnecessary cloud_version bumps.
     */
    private static async projectDataHash(project: Project): Promise<string> {
        const { userEvents, ...rest } = project as any;
        return dataHash(rest);
    }

    // ─── Import / Upload (TUS resumable) ─────────────────────

    /**
     * Import via project-create-v2, which does not return signed URLs.
     * Upload is done via TUS resumable (chunked) so per-chunk retries are
     * handled by tus-js-client and a single transient failure doesn't fail
     * the whole upload. (The v1 signed-URL flow was removed at
     * decommission — git history has it.)
     */
    static async importRecordingLocalV2(
        recording: RawRecording,
        screenBlob: Blob,
        workspaceId: string,
        cameraBlob?: Blob,
        micBlob?: Blob,
        opts: { defaultSettings?: ProjectSettings } = {},
    ): Promise<{ project: Project; name: string; slug: string; bucket: string; uploads: { fileType: string; storagePath: string }[] }> {
        const projectId = recording.id;

        const screenSource = { ...recording.screenSource, storagePath: '' };
        const cameraSource = recording.cameraSource && cameraBlob
            ? { ...recording.cameraSource, storagePath: '' }
            : undefined;
        const microphoneSource = recording.microphoneSource && micBlob
            ? { ...recording.microphoneSource, storagePath: '' }
            : undefined;

        // Personal defaults (plans/user-default-project-settings): already
        // resolved onto the factory by the caller; fitted here to the real
        // camera's aspect. Absent → the shipped factory defaults.
        const settings = opts.defaultSettings
            ? adaptDefaultsToSources(opts.defaultSettings, cameraSource)
            : undefined;
        const project = ProjectImpl.createFromSource(
            projectId, screenSource, recording.userEvents,
            cameraSource, microphoneSource, settings,
        );

        let name = recording.name || 'New Project';
        if (name.length > 40) name = name.substring(0, 37) + '...';

        const { slug, bucket, uploads } = await CloudStorage.createProjectV2(project, name, workspaceId);

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

        return { project, name, slug, bucket, uploads };
    }

    /**
     * Kick off a media upload for a project and register it in `activeUploads`
     * so other parts of the app (loadProject, saveProject) can see it's in
     * flight. Dedupes: if an upload for this projectId is already running,
     * returns the existing promise.
     *
     * Progress and the terminal outcome are reported as an upload task in
     * useActivityStore (the editor header's badge, the dashboard card's
     * badge, the toasts); a failed task carries the retry handler.
     */
    static startMediaUpload(
        projectId: string,
        projectName: string,
        bucket: string,
        uploads: { fileType: string; storagePath: string }[],
        blobs: { fileType: string; blob: Blob }[],
        slug: string | null = null,
    ): Promise<void> {
        const existing = this.activeUploads.get(projectId);
        if (existing) return existing;

        useActivityStore.getState().upsertTask({
            id: uploadTaskId(projectId),
            kind: 'upload',
            projectId,
            projectName,
            projectSlug: slug,
            status: 'active',
            progress: null,
            error: null,
            createdAt: Date.now(),
            completedAt: null,
            retry: null,
        });

        Sentry.addBreadcrumb({
            category: 'upload',
            message: 'startMediaUpload',
            level: 'info',
            data: {
                projectId,
                fileCount: blobs.length,
                totalBytes: blobs.reduce((s, b) => s + b.blob.size, 0),
                fileTypes: blobs.map(b => b.fileType),
            },
        });

        const promise = this.uploadMediaV2(projectId, projectName, bucket, uploads, blobs)
            .then(() => {
                Sentry.addBreadcrumb({
                    category: 'upload',
                    message: 'media upload succeeded',
                    level: 'info',
                    data: { projectId },
                });
                useActivityStore.getState().patchTask(uploadTaskId(projectId), {
                    status: 'completed', progress: 1, completedAt: Date.now(),
                });
            })
            .catch((e) => {
                // uploadMediaV2 already Sentry-captures the underlying error.
                // Here we just surface it to the UI and don't rethrow — this
                // promise is fire-and-forget, rethrowing would produce an
                // unhandled rejection.
                const message = e instanceof Error ? e.message : String(e);
                useActivityStore.getState().patchTask(uploadTaskId(projectId), {
                    status: 'failed',
                    error: message,
                    retry: () => {
                        Sentry.addBreadcrumb({
                            category: 'upload',
                            message: 'user clicked retry',
                            level: 'info',
                            data: { projectId },
                        });
                        this.activeUploads.delete(projectId);
                        this.startMediaUpload(projectId, projectName, bucket, uploads, blobs, slug);
                    },
                });
            })
            .finally(() => {
                this.activeUploads.delete(projectId);
            });

        this.activeUploads.set(projectId, promise);
        return promise;
    }

    /**
     * After a refresh, try to resume an interrupted media upload for a project
     * whose blobs are still in BlobCache. Returns true if an upload was started
     * (or was already running), false if not possible (no blobs cached / wrong
     * project state).
     *
     * Caller is responsible for not awaiting — this is fire-and-forget.
     */
    static async tryResumeUpload(projectId: string, projectName: string): Promise<boolean> {
        if (this.activeUploads.has(projectId)) return true;

        Sentry.addBreadcrumb({
            category: 'upload',
            message: 'tryResumeUpload',
            level: 'info',
            data: { projectId },
        });

        const cloud = await CloudStorage.loadProjectMetadata({ projectId });
        if (!cloud || cloud.upload_status !== 'pending') return false;

        const project = cloud.project_data as Project;
        const sources: { fileType: string; storagePath?: string }[] = [];
        if (project.screenSource) sources.push({ fileType: 'screen', storagePath: project.screenSource.storagePath });
        if (project.cameraSource) sources.push({ fileType: 'camera', storagePath: project.cameraSource.storagePath });
        if (project.microphoneSource) sources.push({ fileType: 'mic', storagePath: project.microphoneSource.storagePath });

        if (sources.length === 0) {
            Sentry.addBreadcrumb({ category: 'upload', message: 'resume aborted: no media sources', level: 'warning', data: { projectId } });
            return false;
        }

        for (const s of sources) {
            if (!s.storagePath) {
                Sentry.addBreadcrumb({ category: 'upload', message: 'resume aborted: missing storagePath', level: 'warning', data: { projectId, fileType: s.fileType } });
                return false;
            }
        }

        return this.resumeUploadFromPaths(
            projectId, projectName, cloud.slug,
            sources.map(s => ({ fileType: s.fileType, storagePath: s.storagePath! })),
        );
    }

    /**
     * Restart an upload from BlobCache given the media paths (from the
     * project list or project_data). Every path must be cached — a partial
     * set can't complete the project. Returns false (with a breadcrumb)
     * when it can't; true once the upload is running.
     */
    static async resumeUploadFromPaths(
        projectId: string,
        projectName: string,
        slug: string | null,
        paths: { fileType: string; storagePath: string }[],
    ): Promise<boolean> {
        if (this.activeUploads.has(projectId)) return true;
        if (paths.length === 0) return false;

        const blobs: { fileType: string; blob: Blob }[] = [];
        for (const p of paths) {
            const blob = await BlobCache.getBlobIfCached(p.storagePath);
            if (!blob) {
                Sentry.addBreadcrumb({ category: 'upload', message: 'resume aborted: blob not in cache', level: 'warning', data: { projectId, fileType: p.fileType, storagePath: p.storagePath } });
                return false;
            }
            blobs.push({ fileType: p.fileType, blob });
        }

        Sentry.addBreadcrumb({
            category: 'upload',
            message: 'resume starting from BlobCache',
            level: 'info',
            data: { projectId, fileCount: blobs.length, totalBytes: blobs.reduce((s, b) => s + b.blob.size, 0) },
        });

        this.startMediaUpload(projectId, projectName, 'project-media', paths, blobs, slug);
        return true;
    }

    /**
     * Dashboard: pick up every listed pending project's upload where it left
     * off. The list already dropped projects whose media isn't cached here,
     * so a miss is unexpected (evicted between list and resume) — logged,
     * not raised. Deduped by `activeUploads`, so calling twice is safe.
     */
    static resumePendingUploads(items: ProjectListItem[]): void {
        for (const item of items) {
            if (item.uploadStatus !== 'pending' || !item.mediaPaths || this.activeUploads.has(item.id)) continue;
            this.resumeUploadFromPaths(
                item.id, item.name, item.shareSlug,
                item.mediaPaths.map(p => ({ fileType: p.type, storagePath: p.storagePath })),
            ).catch(e => captureError(e, { flow: 'upload_resume', projectId: item.id }));
        }
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
        projectName: string,
        bucket: string,
        uploads: { fileType: string; storagePath: string }[],
        blobs: { fileType: string; blob: Blob }[],
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
            store.setCurrentUpload({ projectId, projectName, type: 'media', progress: fraction });
            useActivityStore.getState().patchTask(uploadTaskId(projectId), { progress: fraction });
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
        ref: { projectId: string } | { slug: string },
        onStatus?: (status: string) => void,
    ): Promise<{ project: Project; name: string; meta: ProjectShareMeta } | null> {
        onStatus?.('Loading project...');
        console.log('[CloudProjectService.loadProject] Loading project:', ref);
        const cloudProject = await CloudStorage.loadProjectMetadata(ref);
        if (!cloudProject) {
            console.error('[CloudProjectService.loadProject] loadProjectMetadata returned null — project_get returned NULL. Possible auth.uid() mismatch.');
            return null;
        }
        const projectId = cloudProject.id;
        console.log('[CloudProjectService.loadProject] Got metadata:', { upload_status: cloudProject.upload_status, cloud_version: cloudProject.cloud_version, created_by: cloudProject.created_by });

        // Projects may be in 'pending' state while a background upload is in
        // flight (ImportPage navigates to the editor before the upload
        // completes) or after a refresh where blobs are still cached locally
        // and we can resume. In either case we allow the load; otherwise the
        // project is orphaned and we reject.
        if (cloudProject.upload_status !== 'ready') {
            if (cloudProject.upload_status === 'pending') {
                if (this.isUploadActive(projectId)) {
                    console.log('[CloudProjectService.loadProject] Pending project — upload is active in this tab, allowing load');
                } else {
                    console.log('[CloudProjectService.loadProject] Pending project — attempting refresh-resume from BlobCache');
                    const resumed = await this.tryResumeUpload(projectId, cloudProject.name);
                    if (!resumed) {
                        console.log('[CloudProjectService.loadProject] Pending project with no cached blobs — orphaned, rejecting');
                        return null;
                    }
                }
            } else {
                console.log('[CloudProjectService.loadProject] Rejecting project with non-ready upload_status:', cloudProject.upload_status);
                return null;
            }
        }

        const rawProject = cloudProject.project_data as Project;
        rawProject.id = projectId;

        const project = { ...migrateProject(rawProject) };

        this.cloudVersions.set(projectId, cloudProject.cloud_version);

        // Backfill storagePath on sources for pre-v5 projects. Media
        // lives under the creator's prefix ({created_by}/{projectId}/…).
        // (Was `cloudProject.user_id` — a field project-get never
        // returned, so the backfill built "undefined/…" paths; the
        // shared contract surfaced it.)
        const userId = cloudProject.created_by;
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

        return { project, name: cloudProject.name, meta: toShareMeta(cloudProject) };
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

        // Hold saves while THIS project's media is still uploading — edits
        // buffer locally and flush when the upload completes. Per project:
        // the dashboard may be resuming other projects' uploads meanwhile.
        if (this.activeUploads.has(projectId)) return;

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
     *
     * Pending projects (upload never finished) are kept only when every
     * media file is still in this browser's BlobCache — that's the only
     * place the upload can resume from. Elsewhere (another device, cleared
     * site data) they're invisible until the daily job trashes them.
     */
    static async listProjects(workspaceId: string): Promise<ProjectListItem[]> {
        const summaries = await CloudStorage.listProjectsSummary(workspaceId);

        const items: ProjectListItem[] = summaries.map((s: CloudProjectSummary) => ({
            id: s.id,
            name: s.name,
            thumbnail: null,
            thumbnailStoragePath: s.thumbnail_storage_path,
            updatedAt: s.updated_at,
            createdAt: s.created_at,
            lastAccessedAt: s.last_accessed_at,
            ownerId: s.owner_id,
            deletedAt: s.deleted_at,
            isShared: s.is_shared,
            cloudVersion: s.cloud_version,
            durationMs: s.duration_ms,
            shareSlug: s.slug,
            sharePolicy: s.share_policy ?? null,
            workspaceAccess: s.workspace_access ?? null,
            isEditor: s.is_editor,
            editorRole: s.editor_role ?? null,
            uploadStatus: s.upload_status === 'pending' ? 'pending' : 'ready',
            mediaPaths: s.upload_status === 'pending' ? (s.media_paths ?? []) : null,
        }));

        const resumable = await Promise.all(items.map(async item => {
            if (item.uploadStatus !== 'pending') return true;
            if (!item.mediaPaths || item.mediaPaths.length === 0) return false;
            const cached = await Promise.all(item.mediaPaths.map(p => BlobCache.has(p.storagePath)));
            return cached.every(Boolean);
        }));
        return items.filter((_, i) => resumable[i]);
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
        const result = await this.loadProject({ projectId });
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

    // ─── Rename ──────────────────────────────────────────────────

    static async renameProject(projectId: string, name: string): Promise<void> {
        await CloudStorage.renameProject(projectId, name);
    }
}
