import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;

const BUCKET = 'project-media';

/**
 * Mux Video Upload — the smart orchestrator (internal-only)
 *
 * Called by render-update-status on render completion (fire-and-forget)
 * and by get-published-project when video page needs a video.
 * Auth: RENDER_SECRET in Authorization header.
 *
 * Idempotent: mux_video_start handles cache hit / dedup / cancel stale.
 *
 * Request body: { projectId }
 * Response:     { status, mux_video_id?, jobId? }
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Verify RENDER_SECRET
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${RENDER_SECRET}`) {
            return errorResponse('Unauthorized', 401);
        }

        // 2. Parse request
        const { projectId } = await req.json();
        if (!projectId) {
            return errorResponse('Missing projectId', 400);
        }

        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 3. Call mux_video_start — atomic cache/dedup/cancel/insert
        const { data: result, error: rpcError } = await adminSupabase
            .rpc('mux_video_start', {
                p_project_id: projectId,
            })
            .single();

        if (rpcError || !result) {
            console.error('[mux-video-upload] mux_video_start failed:', rpcError);
            return errorResponse('Failed to start mux video', 500);
        }

        // not_shared: project was never shared — skip
        if (result.status === 'not_shared') {
            return jsonResponse({ status: 'not_shared' });
        }

        // completed: already uploaded for this cloud_version — skip
        if (result.status === 'completed') {
            return jsonResponse({ status: 'completed', mux_video_id: result.mux_video_id });
        }

        // pending (not new): upload already in progress — skip
        if (result.status === 'pending' && !result.is_new) {
            return jsonResponse({ status: 'pending', mux_video_id: result.mux_video_id });
        }

        // needs_render: no completed render for this cloud_version — trigger render
        if (result.needs_render) {
            // Call render-start-job with service role auth
            const renderResp = await fetch(`${SUPABASE_URL}/functions/v1/render-start-job`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                },
                body: JSON.stringify({ projectId }),
            });

            const renderResult = await renderResp.json();
            return jsonResponse({
                status: 'render_needed',
                jobId: renderResult.jobId,
            });
        }

        // is_new = true: new pending row created, proceed to Mux upload
        const muxVideoId = result.mux_video_id;
        const renderStoragePath = result.render_storage_path;

        // 4. Generate signed URL for rendered MP4
        const { data: signedUrlData, error: signError } = await adminSupabase
            .storage.from(BUCKET)
            .createSignedUrl(renderStoragePath, 3600);

        if (signError || !signedUrlData) {
            console.error('[mux-video-upload] Failed to sign render URL:', signError);
            await adminSupabase
                .from('mux_videos')
                .update({ status: 'failed', error: 'Failed to generate signed URL', updated_at: new Date().toISOString() })
                .eq('id', muxVideoId);
            return errorResponse('Failed to generate signed URL', 500);
        }

        // 5. Create Mux asset via API
        const muxAuth = btoa(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`);
        const muxResp = await fetch('https://api.mux.com/video/v1/assets', {
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

        if (!muxResp.ok) {
            const muxError = await muxResp.text();
            console.error('[mux-video-upload] Mux API error:', muxError);
            await adminSupabase
                .from('mux_videos')
                .update({ status: 'failed', error: `Mux API error: ${muxResp.status}`, updated_at: new Date().toISOString() })
                .eq('id', muxVideoId);
            return errorResponse('Mux asset creation failed', 500);
        }

        const muxData = await muxResp.json();
        const muxAssetId = muxData.data.id;

        // 6. Update mux_videos row with asset ID (status stays pending — webhook will complete)
        await adminSupabase
            .from('mux_videos')
            .update({ mux_asset_id: muxAssetId, updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);

        return jsonResponse({ status: 'pending', mux_video_id: muxVideoId });
    } catch (err) {
        console.error('[mux-video-upload] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
