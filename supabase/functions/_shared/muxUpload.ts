import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = ReturnType<typeof createClient>;

const BUCKET = 'project-media';

/**
 * Upload a rendered MP4 to Mux and update the mux_video row.
 *
 * On success: stores mux_asset_id + render_storage_path (status stays 'pending' — Mux webhook completes it).
 * On failure: marks the mux_video as 'failed'.
 *
 * Used by: mux-video-create (when render is already done) and render-hook (on render completion).
 */
export async function uploadToMux(params: {
    adminSupabase: SupabaseClient;
    muxVideoId: string;
    renderStoragePath: string;
    muxTokenId: string;
    muxTokenSecret: string;
}): Promise<{ success: boolean; muxAssetId?: string; error?: string }> {
    const { adminSupabase, muxVideoId, renderStoragePath, muxTokenId, muxTokenSecret } = params;

    // 1. Generate signed download URL for the rendered MP4
    const { data: signedUrlData, error: signError } = await adminSupabase
        .storage.from(BUCKET)
        .createSignedUrl(renderStoragePath, 3600);

    if (signError || !signedUrlData) {
        console.error('[muxUpload] Failed to sign render URL:', signError);
        await adminSupabase
            .from('mux_videos')
            .update({ status: 'failed', error: 'Failed to generate signed URL', updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);
        return { success: false, error: 'Failed to generate signed URL' };
    }

    // 2. Create Mux asset
    console.log(`[muxUpload] Creating Mux asset for mux_video ${muxVideoId}`);
    const muxAuth = btoa(`${muxTokenId}:${muxTokenSecret}`);

    let muxResp: Response;
    try {
        muxResp = await fetch('https://api.mux.com/video/v1/assets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${muxAuth}`,
            },
            body: JSON.stringify({
                input: [{ url: signedUrlData.signedUrl }],
                playback_policy: ['public'],
            }),
        });
    } catch (err) {
        console.error('[muxUpload] Mux API request failed:', err);
        await adminSupabase
            .from('mux_videos')
            .update({ status: 'failed', error: 'Mux API request failed', updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);
        return { success: false, error: 'Mux API request failed' };
    }

    if (!muxResp.ok) {
        const muxError = await muxResp.text();
        console.error('[muxUpload] Mux API error:', muxError);
        await adminSupabase
            .from('mux_videos')
            .update({ status: 'failed', error: `Mux API error: ${muxResp.status}`, updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);
        return { success: false, error: `Mux API error: ${muxResp.status}` };
    }

    const muxData = await muxResp.json();
    const muxAssetId = muxData.data.id;
    console.log(`[muxUpload] Mux asset created: ${muxAssetId}, waiting for webhook`);

    // 3. Store mux_asset_id + render_storage_path (status stays 'pending' — webhook completes)
    await adminSupabase
        .from('mux_videos')
        .update({
            mux_asset_id: muxAssetId,
            render_storage_path: renderStoragePath,
            updated_at: new Date().toISOString(),
        })
        .eq('id', muxVideoId);

    return { success: true, muxAssetId };
}
