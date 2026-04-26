import * as Sentry from '@sentry/react';
import * as tus from 'tus-js-client';
import { supabase, AuthManager } from '../../auth/AuthManager';

const SHARE_BASE_URL = import.meta.env.PROD
    ? 'https://app.recordio.cc/watch'
    : 'http://localhost:3001/watch';

// TODO: Add per-video view alerting when viewership exceeds thresholds (10k, 100k, 1M).
// Use CF Stream Analytics API to poll view counts periodically (e.g., daily cron via Supabase pg_cron
// or a CF Worker). When a threshold is crossed, send an email/notification to the admin.
// Consider auto-pausing or restricting the video if it exceeds a hard cap to control streaming costs.

export interface SharedVideo {
    id: string;           // project ID (used as share ID in URLs)
    user_id: string;
    project_name: string; // mapped from projects.name
    description: string;  // mapped from projects.share_description
    cf_video_uid: string;
    published_at: string;
    updated_at: string;
}

export interface ShareResult {
    shareId: string;
    shareUrl: string;
    videoUid: string;
    isUpdate: boolean;
}

// ─── In-memory cache ────────────────────────────────────────
// Avoids hitting the DB every time ExportSettings or Header mounts.
// Invalidated on publish, republish, and delete.

const cache = {
    /** Cached share per project ID */
    byProject: new Map<string, SharedVideo | null>(),
};

/** Map a projects-table row to the SharedVideo interface */
function toSharedVideo(row: any): SharedVideo {
    return {
        id: row.id,
        user_id: row.user_id,
        project_name: row.name,
        description: row.share_description || '',
        cf_video_uid: row.cf_video_uid,
        published_at: row.published_at,
        updated_at: row.updated_at,
    };
}

export class ShareService {
    /**
     * Get the existing shared video for a project (if any).
     * Uses in-memory cache — only hits the DB on first call per project.
     */
    static async getShareForProject(projectId: string): Promise<SharedVideo | null> {
        if (!supabase) return null;

        // Return cached value if available
        if (cache.byProject.has(projectId)) {
            return cache.byProject.get(projectId) ?? null;
        }

        try {
            const { data } = await supabase
                .from('projects')
                .select('id, user_id, name, share_description, cf_video_uid, published_at, updated_at')
                .eq('id', projectId)
                .not('cf_video_uid', 'is', null)
                .not('published_at', 'is', null)
                .is('deleted_at', null)
                .maybeSingle();

            const result = data ? toSharedVideo(data) : null;
            cache.byProject.set(projectId, result);
            return result;
        } catch {
            return null;
        }
    }

    /**
     * Upload a video blob to Cloudflare Stream via Direct Creator Upload.
     * 3-step flow:
     *   1. Request a one-time upload URL from the edge function
     *   2. Upload the blob directly to Cloudflare
     *   3. Confirm the upload with the edge function
     * Invalidates the cache on success.
     */
    static async shareVideo(
        blob: Blob,
        projectId: string,
        projectName: string,
        options?: { resetViews?: boolean; onUploadProgress?: (fraction: number) => void },
    ): Promise<ShareResult> {
        if (!supabase) {
            throw new Error('Supabase not configured');
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Step 1: Get TUS upload URL from edge function
        const uploadData = await ShareService.requestUploadUrl(
            session.access_token, projectId, projectName, blob.size
        );

        // Step 2: Upload directly to Cloudflare (XHR for progress tracking)
        await ShareService.uploadDirectToCF(
            uploadData.uploadURL, blob, options?.onUploadProgress
        );

        // Step 3: Confirm upload completion (tiny JSON request)
        await ShareService.confirmUpload(session.access_token, uploadData.shareId);

        // Invalidate cache so next reads are fresh
        ShareService.invalidateCache(projectId);

        return {
            shareId: uploadData.shareId,
            shareUrl: `${SHARE_BASE_URL}/${uploadData.shareId}`,
            videoUid: uploadData.uid,
            isUpdate: uploadData.isUpdate,
        };
    }

    /** Step 1: Request a TUS upload URL from the edge function */
    private static async requestUploadUrl(
        accessToken: string, projectId: string, projectName: string, fileSize: number
    ): Promise<{ uploadURL: string; uid: string; shareId: string; isUpdate: boolean }> {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const url = `${supabaseUrl}/functions/v1/upload-to-stream`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectId, projectName, fileSize }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Failed to get upload URL (${response.status})`);
        }

        return data;
    }

    /** Step 2: Upload video blob directly to Cloudflare via TUS */
    private static async uploadDirectToCF(
        uploadURL: string, blob: Blob, onUploadProgress?: (fraction: number) => void
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const upload = new tus.Upload(blob, {
                uploadUrl: uploadURL,
                chunkSize: 50 * 1024 * 1024, // 50 MB chunks
                retryDelays: [0, 3000, 5000, 10000, 20000],
                onError: (error) => {
                    reject(new Error(`TUS upload failed: ${error.message}`));
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                    onUploadProgress?.(bytesUploaded / bytesTotal);
                },
                onSuccess: () => {
                    resolve();
                },
            });
            upload.start();
        });
    }

    /** Step 3: Confirm upload completion with the edge function */
    private static async confirmUpload(accessToken: string, shareId: string): Promise<void> {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const url = `${supabaseUrl}/functions/v1/confirm-upload`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ shareId }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Failed to confirm upload (${response.status})`);
        }
    }

    /**
     * Delete a shared video (unpublish).
     * Queues CF video for async deletion via the edge function (instant),
     * which also clears the publish columns on the project.
     */
    static async deleteSharedVideo(projectId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        // 1. Get the video UID
        const { data: project } = await supabase
            .from('projects')
            .select('cf_video_uid')
            .eq('id', projectId)
            .not('cf_video_uid', 'is', null)
            .single();

        if (!project?.cf_video_uid) {
            throw new Error('Video not found');
        }

        // 2. Queue for async CF deletion + clear publish columns (handled by edge function)
        const session = await AuthManager.getSession();
        if (!session) throw new Error('Not authenticated');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const cfResponse = await fetch(`${supabaseUrl}/functions/v1/delete-from-stream`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cf_video_uid: project.cf_video_uid }),
        });

        if (!cfResponse.ok) {
            const errorData = await cfResponse.json().catch(() => ({}));
            console.error('[Share] Deletion queue failed:', errorData);
            Sentry.captureException(new Error('Video deletion queue failed'), {
                extra: { phase: 'queue_delete', projectId, cfVideoUid: project.cf_video_uid, status: cfResponse.status }
            });
            throw new Error('Failed to delete video');
        }

        // 3. Invalidate cache
        ShareService.invalidateCache(projectId);
    }

    /**
     * Get the public share URL for a project ID.
     */
    static getShareUrl(projectId: string): string {
        return `${SHARE_BASE_URL}/${projectId}`;
    }

    /**
     * Get the current authenticated user's ID (or null).
     */
    static async getCurrentUserId(): Promise<string | null> {
        if (!supabase) return null;
        const { data: { user } } = await supabase.auth.getUser();
        return user?.id || null;
    }

    /**
     * Rename a shared video's title (updates project name).
     */
    static async renameSharedVideo(projectId: string, newTitle: string): Promise<boolean> {
        if (!supabase) return false;

        try {
            const { error } = await supabase
                .from('projects')
                .update({ name: newTitle })
                .eq('id', projectId);

            if (error) {
                console.error('[Share] Rename failed:', error);
                return false;
            }

            cache.byProject.delete(projectId);

            return true;
        } catch (error) {
            console.error('[Share] Rename error:', error);
            return false;
        }
    }

    /**
     * Get a published project by its ID (for the watch page).
     * This doesn't require auth — anyone with the link can see metadata.
     * Goes through an edge function that bypasses RLS and returns only public-safe columns.
     */
    static async getSharedVideoById(projectId: string): Promise<SharedVideo | null> {
        if (!supabase) return null;

        try {
            const res = await supabase.functions.invoke('get-published-project', {
                body: { projectId },
            });

            if (res.error || !res.data?.project) return null;

            return toSharedVideo(res.data.project);
        } catch {
            return null;
        }
    }

    /**
     * Update a shared video's title and/or description.
     * Requires auth — only the owner can update (RLS enforced).
     */
    static async updateSharedVideoMeta(
        projectId: string,
        updates: { project_name?: string; description?: string }
    ): Promise<boolean> {
        if (!supabase) return false;

        try {
            const dbUpdates: Record<string, unknown> = {};
            if (updates.project_name !== undefined) dbUpdates.name = updates.project_name;
            if (updates.description !== undefined) dbUpdates.share_description = updates.description;

            const { error } = await supabase
                .from('projects')
                .update(dbUpdates)
                .eq('id', projectId);

            if (error) {
                console.error('[Share] Update meta failed:', error);
                return false;
            }

            // Invalidate cache so dashboard picks up changes
            cache.byProject.clear();

            return true;
        } catch (error) {
            console.error('[Share] Update meta error:', error);
            return false;
        }
    }

    /**
     * Invalidate the in-memory cache.
     * Called after publish, republish, or delete.
     */
    static invalidateCache(projectId?: string): void {
        if (projectId) {
            cache.byProject.delete(projectId);
        } else {
            cache.byProject.clear();
        }
    }
}
