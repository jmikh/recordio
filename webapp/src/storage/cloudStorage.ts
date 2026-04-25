import { supabase } from '../auth/AuthManager';
import * as tus from 'tus-js-client';
import type { Project } from '../types';

/**
 * Summary row returned by listProjectsSummary — lightweight for dashboard display.
 */
export interface CloudProjectSummary {
    id: string;
    name: string;
    thumbnail_storage_path: string | null;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    expires_at: string | null;
    upload_status: string;
    cf_video_uid: string | null;
    cloud_version: number;
    duration_ms: number | null;
}

/**
 * Full cloud project row (metadata only, no media blobs).
 */
export interface CloudProject {
    id: string;
    user_id: string;
    name: string;
    project_data: any;
    cloud_version: number;
    upload_status: string;
    cf_video_uid: string | null;
    published_at: string | null;
    share_description: string;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    expires_at: string | null;
    screen_storage_path: string | null;
    camera_storage_path: string | null;
    mic_storage_path: string | null;
    thumbnail_storage_path: string | null;
}

export interface StorageQuota {
    usedBytes: number;
    limitBytes: number;
    maxProjects: number;
}

export type MediaFileType = 'screen' | 'camera' | 'mic' | 'thumbnail';

/**
 * Cloud storage client for the `projects` table.
 * All operations go through the Supabase client with RLS (user's JWT).
 * Media upload/download uses signed URLs via edge functions.
 */
export class CloudStorage {
    // ─── Metadata CRUD ──────────────────────────────────────────

    /**
     * Upsert project metadata to cloud.
     * Uses optimistic concurrency: if expectedVersion is provided, the update
     * only succeeds if cloud_version matches. Returns the new cloud_version.
     */
    static async saveProjectMetadata(
        project: Project,
        userId: string,
        expectedVersion?: number,
        isPro?: boolean,
    ): Promise<{ cloudVersion: number }> {
        if (!supabase) throw new Error('Supabase not configured');

        // Strip non-serializable / transient fields from project before storing as JSONB
        const projectData = this.stripForCloud(project);

        if (expectedVersion !== undefined) {
            // Update existing — optimistic concurrency
            const { data, error } = await supabase
                .from('projects')
                .update({
                    name: project.name,
                    project_data: projectData,
                    cloud_version: expectedVersion + 1,
                    duration_ms: this.computeDurationMs(project),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', project.id)
                .eq('cloud_version', expectedVersion)
                .select('cloud_version')
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    throw new CloudVersionConflictError(project.id, expectedVersion);
                }
                throw error;
            }

            return { cloudVersion: data.cloud_version };
        } else {
            // Insert or update — upsert on PK handles dedup across tabs
            const { data, error } = await supabase
                .from('projects')
                .upsert({
                    id: project.id,
                    user_id: userId,
                    name: project.name,
                    project_data: projectData,
                    duration_ms: this.computeDurationMs(project),
                    upload_status: 'pending',
                    screen_storage_path: project.screenSource ? 'pending' : null,
                    camera_storage_path: project.cameraSource ? 'pending' : null,
                    mic_storage_path: project.microphoneSource ? 'pending' : null,
                    expires_at: isPro ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                })
                .select('cloud_version')
                .single();

            if (error) throw error;
            return { cloudVersion: data.cloud_version };
        }
    }

    /**
     * Fetch only the cloud_version for a project (lightweight — no project_data).
     * Returns null if the project doesn't exist in cloud.
     */
    static async getCloudVersion(projectId: string): Promise<number | null> {
        if (!supabase) return null;

        const { data, error } = await supabase
            .from('projects')
            .select('cloud_version')
            .eq('id', projectId)
            .is('deleted_at', null)
            .maybeSingle();

        if (error || !data) return null;
        return data.cloud_version;
    }

    /**
     * Load full project metadata from cloud.
     */
    static async loadProjectMetadata(projectId: string): Promise<CloudProject | null> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .is('deleted_at', null)
            .maybeSingle();

        if (error) throw error;
        return data;
    }

    /**
     * List project summaries for the dashboard (lightweight — no project_data).
     */
    static async listProjectsSummary(): Promise<CloudProjectSummary[]> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase
            .from('projects')
            .select('id, name, thumbnail_storage_path, last_accessed_at, updated_at, created_at, expires_at, upload_status, cf_video_uid, cloud_version, duration_ms')
            .is('deleted_at', null)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data ?? [];
    }

    /**
     * Soft-delete a project (sets deleted_at).
     */
    static async softDeleteProject(projectId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
            .from('projects')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', projectId);

        if (error) throw error;
    }

    /**
     * Update last_accessed_at (called when user opens a project).
     */
    static async updateLastAccessed(projectId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase
            .from('projects')
            .update({ last_accessed_at: new Date().toISOString() })
            .eq('id', projectId);

        if (error) throw error;
    }

    // ─── Quota ──────────────────────────────────────────────────

    /**
     * Get the user's current storage usage and limits.
     */
    static async getStorageQuota(): Promise<StorageQuota> {
        if (!supabase) throw new Error('Supabase not configured');

        // Get usage via RPC
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: usedBytes, error: rpcError } = await supabase
            .rpc('get_user_storage_bytes', { p_user_id: user.id });

        if (rpcError) throw rpcError;

        const { data: quota, error: quotaError } = await supabase
            .from('user_quotas')
            .select('storage_limit_bytes, max_projects')
            .eq('user_id', user.id)
            .maybeSingle();

        if (quotaError) throw quotaError;

        return {
            usedBytes: usedBytes ?? 0,
            limitBytes: quota?.storage_limit_bytes ?? 26843545600, // 25 GB default
            maxProjects: quota?.max_projects ?? 50,
        };
    }

    // ─── Media Upload / Download ──────────────────────────────────

    /**
     * Request a signed upload URL from the edge function.
     * Returns the URL and storage path for a specific media file.
     */
    static async requestUploadUrl(
        projectId: string,
        fileType: MediaFileType,
        sizeBytes: number,
    ): Promise<{ signedUrl: string; token: string; storagePath: string }> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.functions.invoke('storage-upload-url', {
            body: { projectId, fileType, sizeBytes },
        });

        if (error) throw error;
        if (data?.error) {
            if (data.error === 'quota_exceeded') {
                throw new StorageQuotaExceededError(data.usedBytes, data.limitBytes);
            }
            throw new Error(data.error);
        }

        return data;
    }

    /** Map fileType to the clean MIME type expected by the storage bucket */
    private static mimeForFileType(fileType: MediaFileType): string {
        switch (fileType) {
            case 'screen': return 'video/webm';
            case 'camera': return 'video/webm';
            case 'mic':    return 'audio/wav';
            case 'thumbnail': return 'image/webp';
        }
    }

    /**
     * Upload a blob to the signed URL. Uses XMLHttpRequest for progress tracking.
     * Only used for small files (thumbnails). Large media uses TUS resumable upload.
     */
    static async uploadBlob(
        signedUrl: string,
        blob: Blob,
        contentType: string,
        onProgress?: (fraction: number) => void,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', signedUrl, true);
            xhr.setRequestHeader('Content-Type', contentType);

            if (onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        onProgress(e.loaded / e.total);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
                }
            };

            xhr.onerror = () => reject(new Error('Upload failed: network error'));
            xhr.onabort = () => reject(new Error('Upload aborted'));
            xhr.send(blob);
        });
    }

    /**
     * Upload a blob via TUS resumable upload protocol.
     * Supports large files (screen/camera/mic recordings) that exceed the
     * single-request body size limit. Uploads in 6 MB chunks with automatic retries.
     */
    static async uploadBlobTus(
        storagePath: string,
        blob: Blob,
        contentType: string,
        onProgress?: (fraction: number) => void,
    ): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL not configured');

        return new Promise((resolve, reject) => {
            const upload = new tus.Upload(blob, {
                endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                chunkSize: 6 * 1024 * 1024, // 6 MB
                headers: {
                    authorization: `Bearer ${session.access_token}`,
                    'x-upsert': 'true',
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                    bucketName: 'project-media',
                    objectName: storagePath,
                    contentType,
                    cacheControl: '3600',
                },
                onError: (error) => {
                    reject(new Error(`TUS upload failed: ${error.message}`));
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                    onProgress?.(bytesUploaded / bytesTotal);
                },
                onSuccess: () => {
                    resolve();
                },
            });

            // Check for previous incomplete uploads and resume if found
            upload.findPreviousUploads().then((previousUploads) => {
                if (previousUploads.length > 0) {
                    upload.resumeFromPreviousUpload(previousUploads[0]);
                }
                upload.start();
            });
        });
    }

    /**
     * Confirm a media upload completed — updates the project row with storage path and size.
     * Atomically sets upload_status = 'ready' when all media is uploaded.
     */
    static async confirmMediaUpload(
        projectId: string,
        fileType: MediaFileType,
        storagePath: string,
        sizeBytes: number,
    ): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.functions.invoke('storage-confirm-media', {
            body: { projectId, fileType, storagePath, sizeBytes },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
    }

    /**
     * Full media upload pipeline for a single file type:
     * 1. Request upload URL (validates quota + ownership)
     * 2. Upload blob — TUS resumable for large media, signed URL PUT for thumbnails
     * 3. Confirm upload (updates project row)
     */
    static async uploadMediaFile(
        projectId: string,
        fileType: MediaFileType,
        blob: Blob,
        onProgress?: (fraction: number) => void,
    ): Promise<string> {
        const { signedUrl, storagePath } = await this.requestUploadUrl(
            projectId, fileType, blob.size,
        );

        const contentType = this.mimeForFileType(fileType);

        if (fileType === 'thumbnail') {
            // Thumbnails are small — use simple signed URL PUT
            await this.uploadBlob(signedUrl, blob, contentType, onProgress);
        } else {
            // Screen/camera/mic can be large — use TUS resumable upload
            await this.uploadBlobTus(storagePath, blob, contentType, onProgress);
        }

        await this.confirmMediaUpload(projectId, fileType, storagePath, blob.size);

        return storagePath;
    }

    /**
     * Request a signed download URL for a storage path.
     */
    static async requestDownloadUrl(storagePath: string): Promise<string> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.functions.invoke('storage-download-url', {
            body: { storagePath },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        return data.signedUrl;
    }

    /**
     * Download a blob from a signed URL.
     */
    static async downloadBlob(
        signedUrl: string,
        onProgress?: (fraction: number) => void,
    ): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', signedUrl, true);
            xhr.responseType = 'blob';

            if (onProgress) {
                xhr.onprogress = (e) => {
                    if (e.lengthComputable) {
                        onProgress(e.loaded / e.total);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response as Blob);
                } else {
                    reject(new Error(`Download failed: ${xhr.status}`));
                }
            };

            xhr.onerror = () => reject(new Error('Download failed: network error'));
            xhr.send();
        });
    }

    /**
     * Full media download pipeline: request signed URL → download blob.
     */
    static async downloadMediaFile(
        storagePath: string,
        onProgress?: (fraction: number) => void,
    ): Promise<Blob> {
        const signedUrl = await this.requestDownloadUrl(storagePath);
        return this.downloadBlob(signedUrl, onProgress);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    /** Compute total output duration in ms from a project's output windows. */
    private static computeDurationMs(project: Project): number {
        const windows = project.timeline?.outputWindows ?? [];
        return Math.round(windows.reduce((acc, w) => acc + (w.endMs - w.startMs), 0));
    }

    /**
     * Strip transient/non-serializable fields from project before storing as JSONB.
     * Removes runtimeUrl, keeps storageUrl.
     */
    static stripForCloud(project: Project): any {
        const stripped = { ...project };

        // Strip runtimeUrl from sources
        if (stripped.screenSource) {
            const { runtimeUrl: _, ...rest } = stripped.screenSource;
            stripped.screenSource = rest as typeof stripped.screenSource;
        }
        if (stripped.cameraSource) {
            const { runtimeUrl: _, ...rest } = stripped.cameraSource;
            stripped.cameraSource = rest as typeof stripped.cameraSource;
        }
        if (stripped.microphoneSource) {
            const { runtimeUrl: _, ...rest } = stripped.microphoneSource;
            stripped.microphoneSource = rest as typeof stripped.microphoneSource;
        }

        // Strip customRuntimeUrl from settings
        if (stripped.settings?.background?.customRuntimeUrl) {
            const { customRuntimeUrl: _, ...rest } = stripped.settings.background;
            stripped.settings = { ...stripped.settings, background: rest as typeof stripped.settings.background };
        }
        if (stripped.settings?.audio?.music?.customRuntimeUrl) {
            const { customRuntimeUrl: _, ...rest } = stripped.settings.audio.music;
            stripped.settings = {
                ...stripped.settings,
                audio: { ...stripped.settings.audio, music: rest as typeof stripped.settings.audio.music }
            };
        }

        return stripped;
    }
}

/**
 * Thrown when a cloud write fails because another device wrote a newer version.
 */
export class CloudVersionConflictError extends Error {
    constructor(public projectId: string, public expectedVersion: number) {
        super(`Cloud version conflict for project ${projectId} (expected v${expectedVersion})`);
        this.name = 'CloudVersionConflictError';
    }
}

/**
 * Thrown when a media upload would exceed the user's storage quota.
 */
export class StorageQuotaExceededError extends Error {
    constructor(public usedBytes: number, public limitBytes: number) {
        super(`Storage quota exceeded (${usedBytes} / ${limitBytes} bytes)`);
        this.name = 'StorageQuotaExceededError';
    }
}
