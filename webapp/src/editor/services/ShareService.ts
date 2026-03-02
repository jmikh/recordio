import * as Sentry from '@sentry/react';
import { supabase, AuthManager } from '../../auth/AuthManager';

const SHARE_BASE_URL = import.meta.env.PROD
    ? 'https://app.recordio.cc/watch'
    : 'http://localhost:3001/watch';

export const MAX_SHARED_VIDEOS = 10;

// TODO: Add per-video view alerting when viewership exceeds thresholds (10k, 100k, 1M).
// Use CF Stream Analytics API to poll view counts periodically (e.g., daily cron via Supabase pg_cron
// or a CF Worker). When a threshold is crossed, send an email/notification to the admin.
// Consider auto-pausing or restricting the video if it exceeds a hard cap to control streaming costs.

export interface SharedVideo {
    id: string;
    user_id: string;
    project_id: string;
    project_name: string;
    description: string;
    cf_video_uid: string;
    version: number;
    created_at: string;
    updated_at: string;
}

export interface ShareResult {
    shareId: string;
    shareUrl: string;
    videoUid: string;
    version: number;
    isUpdate: boolean;
}

export interface ShareQuota {
    current: number;
    max: number;
    canShare: boolean;
}

export interface VideoAnalytics {
    uid: string;
    views: number;
    minutesViewed: number;
    durationSeconds: number;
}

// ─── In-memory cache ────────────────────────────────────────
// Avoids hitting the DB every time ExportSettings or Header mounts.
// Invalidated on publish, republish, and delete.

const cache = {
    /** Cached share per project ID */
    byProject: new Map<string, SharedVideo | null>(),
    /** Cached list of all shared videos (null = not yet fetched) */
    allVideos: null as SharedVideo[] | null,
    /** Cached analytics per video UID */
    analytics: null as Record<string, VideoAnalytics> | null,
};

export class ShareService {
    /**
     * Check if the user can share (pre-flight quota check).
     * Returns current usage and whether a new share is allowed.
     * Re-shares of the same project don't count against the quota.
     */
    static async checkQuota(projectId?: string): Promise<ShareQuota> {
        if (!supabase) {
            return { current: 0, max: MAX_SHARED_VIDEOS, canShare: false };
        }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                return { current: 0, max: MAX_SHARED_VIDEOS, canShare: false };
            }

            const { data, count } = await supabase
                .from('shared_videos')
                .select('project_id', { count: 'exact' })
                .eq('user_id', user.id);

            const currentCount = count ?? 0;

            // If project already has a share, re-sharing doesn't consume a new slot
            const isReshare = projectId && data?.some(v => v.project_id === projectId);
            const canShare = isReshare || currentCount < MAX_SHARED_VIDEOS;

            return { current: currentCount, max: MAX_SHARED_VIDEOS, canShare };
        } catch (error) {
            console.error('[Share] Quota check failed:', error);
            Sentry.captureException(error, { extra: { phase: 'quota_check' } });
            return { current: 0, max: MAX_SHARED_VIDEOS, canShare: false };
        }
    }

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
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;

            const { data } = await supabase
                .from('shared_videos')
                .select('*')
                .eq('user_id', user.id)
                .eq('project_id', projectId)
                .maybeSingle();

            cache.byProject.set(projectId, data);
            return data;
        } catch {
            return null;
        }
    }

    /**
     * Upload a video blob to Cloudflare Stream via the Edge Function.
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

        const formData = new FormData();
        formData.append('video', blob, `${projectName}.mp4`);
        formData.append('projectId', projectId);
        formData.append('projectName', projectName);
        if (options?.resetViews) {
            formData.append('resetViews', 'true');
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const url = `${supabaseUrl}/functions/v1/upload-to-stream`;

        // Use XMLHttpRequest for upload progress tracking
        const result = await new Promise<any>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);

            if (options?.onUploadProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        options.onUploadProgress!(e.loaded / e.total);
                    }
                };
            }

            xhr.onload = () => {
                let data: any;
                try { data = JSON.parse(xhr.responseText); } catch { data = {}; }

                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(data);
                } else if (data.error === 'quota_exceeded') {
                    reject(new Error(data.message || `You've reached the limit of ${MAX_SHARED_VIDEOS} shared videos.`));
                } else {
                    reject(new Error(data.error || `Upload failed (${xhr.status})`));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(formData);
        });

        // Invalidate cache so next reads are fresh
        ShareService.invalidateCache(projectId);

        return {
            shareId: result.shareId,
            shareUrl: `${SHARE_BASE_URL}/${result.shareId}`,
            videoUid: result.videoUid,
            version: result.version,
            isUpdate: result.isUpdate,
        };
    }

    /**
     * Get all shared videos for the current user.
     * Uses in-memory cache — only hits the DB on first call.
     */
    static async getSharedVideos(): Promise<SharedVideo[]> {
        if (!supabase) return [];

        // Return cached value if available
        if (cache.allVideos !== null) {
            return cache.allVideos;
        }

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from('shared_videos')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('[Share] Failed to fetch shared videos:', error);
                Sentry.captureException(error, { extra: { phase: 'list_shared' } });
                return [];
            }

            cache.allVideos = data || [];
            return cache.allVideos;
        } catch (error) {
            console.error('[Share] Unexpected error:', error);
            Sentry.captureException(error, { extra: { phase: 'list_shared' } });
            return [];
        }
    }

    /**
     * Delete a shared video (unshare).
     * Deletes from Cloudflare Stream first, then removes the DB record.
     */
    static async deleteSharedVideo(shareId: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        // 1. Get the video UID and project_id
        const { data: share } = await supabase
            .from('shared_videos')
            .select('cf_video_uid, project_id')
            .eq('id', shareId)
            .single();

        if (!share?.cf_video_uid) {
            throw new Error('Video not found');
        }

        // 2. Delete from Cloudflare Stream first (to avoid orphaned videos)
        const session = await AuthManager.getSession();
        if (!session) throw new Error('Not authenticated');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const cfResponse = await fetch(`${supabaseUrl}/functions/v1/delete-from-stream`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cf_video_uid: share.cf_video_uid }),
        });

        if (!cfResponse.ok) {
            const errorData = await cfResponse.json().catch(() => ({}));
            console.error('[Share] CF deletion failed:', errorData);
            Sentry.captureException(new Error('CF video deletion failed'), {
                extra: { phase: 'cf_delete', shareId, cfVideoUid: share.cf_video_uid, status: cfResponse.status }
            });
            throw new Error('Failed to delete video from Cloudflare');
        }

        // 3. Delete the DB record (CF video is already gone)
        const { error } = await supabase
            .from('shared_videos')
            .delete()
            .eq('id', shareId);

        if (error) {
            console.error('[Share] Failed to delete share from DB:', error);
            Sentry.captureException(error, { extra: { phase: 'delete_share_db', shareId } });
            throw new Error('Failed to unshare video');
        }

        // 4. Invalidate cache
        if (share.project_id) {
            ShareService.invalidateCache(share.project_id);
        } else {
            ShareService.invalidateCache();
        }
    }

    /**
     * Get the public share URL for a shared video ID.
     */
    static getShareUrl(shareId: string): string {
        return `${SHARE_BASE_URL}/${shareId}`;
    }

    /**
     * Get a thumbnail URL for a Cloudflare Stream video.
     */
    static getThumbnailUrl(cfVideoUid: string): string {
        const subdomain = import.meta.env.VITE_CF_CUSTOMER_SUBDOMAIN || 'placeholder';
        return `https://customer-${subdomain}.cloudflarestream.com/${cfVideoUid}/thumbnails/thumbnail.jpg`;
    }

    /**
     * Fetch analytics for a batch of CF Stream video UIDs.
     * Cached in-memory for the page session.
     */
    static async getVideoAnalytics(videoUids: string[]): Promise<Record<string, VideoAnalytics>> {
        if (!supabase || videoUids.length === 0) return {};

        // Return cached if available
        if (cache.analytics !== null) return cache.analytics;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return {};

            const res = await supabase.functions.invoke('get-video-analytics', {
                body: { videoUids },
            });

            if (res.error) {
                console.error('[Share] Analytics fetch failed:', res.error);
                return {};
            }

            cache.analytics = res.data?.analytics || {};
            return cache.analytics!;
        } catch (error) {
            console.error('[Share] Analytics error:', error);
            return {};
        }
    }

    /**
     * Fetch detailed analytics for a single video (includes daily breakdown).
     * Used on the watch page for the owner panel.
     */
    static async getDetailedVideoAnalytics(videoUid: string): Promise<VideoAnalytics & { daily?: { date: string; views: number; minutesViewed: number }[] } | null> {
        if (!supabase) return null;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return null;

            const res = await supabase.functions.invoke('get-video-analytics', {
                body: { videoUids: [videoUid], detailed: true },
            });

            if (res.error) return null;
            return res.data?.analytics?.[videoUid] || null;
        } catch {
            return null;
        }
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
     * Rename a shared video's title (independent from project name).
     */
    static async renameSharedVideo(shareId: string, newTitle: string): Promise<boolean> {
        if (!supabase) return false;

        try {
            const { error } = await supabase
                .from('shared_videos')
                .update({ project_name: newTitle })
                .eq('id', shareId);

            if (error) {
                console.error('[Share] Rename failed:', error);
                return false;
            }

            // Update cache
            if (cache.allVideos) {
                const video = cache.allVideos.find(v => v.id === shareId);
                if (video) video.project_name = newTitle;
            }
            for (const [, v] of cache.byProject) {
                if (v?.id === shareId) {
                    v.project_name = newTitle;
                }
            }

            return true;
        } catch (error) {
            console.error('[Share] Rename error:', error);
            return false;
        }
    }

    /**
     * Get a shared video by its public ID (for the watch page).
     * This doesn't require auth — anyone with the link can see metadata.
     * Not cached since it's a public lookup on a different page.
     */
    static async getSharedVideoById(shareId: string): Promise<SharedVideo | null> {
        if (!supabase) return null;

        const { data, error } = await supabase
            .from('shared_videos')
            .select('*')
            .eq('id', shareId)
            .maybeSingle();

        if (error) return null;
        return data;
    }

    /**
     * Update a shared video's title and/or description.
     * Requires auth — only the owner can update (RLS enforced).
     */
    static async updateSharedVideoMeta(
        shareId: string,
        updates: { project_name?: string; description?: string }
    ): Promise<boolean> {
        if (!supabase) return false;

        try {
            const { error } = await supabase
                .from('shared_videos')
                .update(updates)
                .eq('id', shareId);

            if (error) {
                console.error('[Share] Update meta failed:', error);
                return false;
            }

            // Invalidate cache so dashboard picks up changes
            cache.allVideos = null;
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
        cache.allVideos = null;
    }
}
