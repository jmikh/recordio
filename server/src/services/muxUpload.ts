/**
 * Upload a rendered MP4 to Mux and update the mux_video row — ports
 * `_shared/muxUpload.ts`. Shared on purpose: mux-video-create uses it when
 * the render is already done, render-job-hook reuses it in Wave D.
 *
 * On success: stores mux_asset_id + render_storage_path (status STAYS
 * 'pending' — the Mux webhook completes it). On failure: marks the row
 * 'failed' with the edge fn's exact error strings and returns
 * `{ success: false }` — it never throws.
 *
 * Divergence (documented): the download URL Mux ingests from is an
 * S3Port presigned GET instead of a Supabase-Storage signed URL — same
 * object, different URL flavor; Mux just fetches it.
 */
import type { ExportQuality } from '@shared/utils/exportQuality';
import type { Deps } from '../deps.js';
import { MuxApiError } from '../ports/mux.js';

/**
 * The single render quality that feeds Mux — shared projects stream at
 * 1440p (`2K`). mux-video-create requests exactly this quality, and the
 * render-job webhook only uploads a completed render to Mux when it
 * matches, so a different-quality render for the same version (e.g. a
 * 1080p download export) can never hijack the pending mux_video.
 */
export const MUX_RENDER_QUALITY: ExportQuality = '2K';

export interface MuxUploadResult {
    success: boolean;
    muxAssetId?: string;
    error?: string;
}

/** Mark a mux_video failed with an error string (also used by the mux-video-create route). */
export async function markMuxVideoFailed(
    deps: Pick<Deps, 'db' | 'clock'>,
    muxVideoId: string,
    error: string,
): Promise<void> {
    await deps.db.query(
        `UPDATE mux_videos SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1`,
        [muxVideoId, error, deps.clock.now().toISOString()],
    );
}

export async function uploadToMux(
    deps: Pick<Deps, 'db' | 'clock' | 's3' | 'mux'>,
    opts: { muxVideoId: string; renderStoragePath: string },
): Promise<MuxUploadResult> {
    const { muxVideoId, renderStoragePath } = opts;

    // 1. Signed download URL for the rendered MP4
    let downloadUrl: string;
    try {
        downloadUrl = await deps.s3.presignDownload(renderStoragePath, 3600);
    } catch {
        await markMuxVideoFailed(deps, muxVideoId, 'Failed to generate signed URL');
        return { success: false, error: 'Failed to generate signed URL' };
    }

    // 2. Create the Mux asset
    let muxAssetId: string;
    try {
        ({ assetId: muxAssetId } = await deps.mux.createAsset(downloadUrl));
    } catch (err) {
        const error =
            err instanceof MuxApiError
                ? `Mux API error: ${err.status}`
                : 'Mux API request failed';
        await markMuxVideoFailed(deps, muxVideoId, error);
        return { success: false, error };
    }

    // 3. Store mux_asset_id + render_storage_path (status stays 'pending' — webhook completes)
    await deps.db.query(
        `UPDATE mux_videos
         SET mux_asset_id = $2, render_storage_path = $3, updated_at = $4
         WHERE id = $1`,
        [muxVideoId, muxAssetId, renderStoragePath, deps.clock.now().toISOString()],
    );

    return { success: true, muxAssetId };
}
