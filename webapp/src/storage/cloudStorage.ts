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
    thumbnail_storage_path: string | null;
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
     * Update project metadata in cloud.
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

        const projectData = JSON.parse(JSON.stringify(project));

        const { data, error } = await supabase.rpc('project_update', {
            p_project_id: project.id,
            p_project_data: projectData,
            p_duration_ms: this.computeDurationMs(project),
            p_expected_version: expectedVersion ?? null,
        });

        if (error) throw error;
        if (data === null) {
            throw new CloudVersionConflictError(project.id, expectedVersion!);
        }

        return { cloudVersion: data };
    }

    /**
     * Update only the project name column (no debouncing needed).
     */
    static async updateProjectName(projectId: string, name: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase.rpc('project_update_name', {
            p_project_id: projectId,
            p_name: name,
        });

        if (error) throw error;
    }

    /**
     * Fetch only the cloud_version for a project (lightweight — no project_data).
     * Returns null if the project doesn't exist in cloud.
     */
    static async getCloudVersion(projectId: string): Promise<number | null> {
        if (!supabase) return null;

        // project_get returns full metadata; we only need cloud_version.
        // A dedicated lightweight RPC could be added later if perf matters.
        const { data, error } = await supabase.rpc('project_get', {
            p_project_id: projectId,
        });

        if (error || !data) return null;
        return data.cloud_version;
    }

    /**
     * Load full project metadata from cloud.
     * Also bumps last_accessed_at server-side.
     */
    static async loadProjectMetadata(projectId: string): Promise<CloudProject | null> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.rpc('project_get', {
            p_project_id: projectId,
        });

        if (error) throw error;
        return data;
    }

    /**
     * List project summaries for the dashboard (lightweight — no project_data).
     */
    static async listProjectsSummary(): Promise<CloudProjectSummary[]> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.rpc('project_list');

        if (error) throw error;
        return data ?? [];
    }

    /**
     * Soft-delete a project (sets deleted_at).
     */
    static async softDeleteProject(projectId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { error } = await supabase.rpc('project_delete', {
            p_project_id: projectId,
        });

        if (error) throw error;
    }

    // ─── Media Upload / Download ──────────────────────────────────

    /**
     * Create a project on the server. Sends the full project struct;
     * the server generates storage paths, stamps them into the project,
     * saves to DB with upload_status='pending', and returns signed upload URLs.
     *
     * After uploading blobs, call confirmProjectUpload() to flip status to 'ready'.
     */
    static async createProject(
        project: Project,
        name: string,
        isPro?: boolean,
    ): Promise<{ projectId: string; uploads: { fileType: string; storagePath: string; signedUrl: string; token: string }[] }> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.functions.invoke('project-create', {
            body: { project, name, isPro },
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

    /**
     * Confirm project media upload — flips upload_status from 'pending' to 'ready'.
     */
    static async confirmProjectUpload(projectId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.rpc('project_confirm_upload', {
            p_project_id: projectId,
        });

        if (error) throw error;
        if (!data) console.warn('[CloudStorage] project_confirm_upload returned false — project may already be ready');
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
     * Upload a thumbnail for a project. Sends the blob to the
     * project-update-thumbnail edge function which uploads to storage
     * and updates thumbnail_storage_path on the project row.
     */
    static async uploadThumbnail(
        projectId: string,
        blob: Blob,
    ): Promise<string> {
        if (!supabase) throw new Error('Supabase not configured');

        const formData = new FormData();
        formData.append('projectId', projectId);
        formData.append('file', blob, 'thumbnail.webp');

        const { data, error } = await supabase.functions.invoke('project-update-thumbnail', {
            body: formData,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        return data.storagePath;
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
