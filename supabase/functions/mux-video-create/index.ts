import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { uploadToMux } from '../_shared/muxUpload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;

/**
 * Mux Video Create Edge Function
 *
 * Auth: User JWT + Pro check (via withAuth + manual Pro check).
 * Creates or resolves a mux_video row for a specific cloud_version.
 * If the render is already done, uploads to Mux immediately.
 *
 * Request body: { projectId, cloudVersion }
 * Response:     { status, muxVideoId? }
 */
serve(withAuth(async (req, { user, supabase: userSupabase }) => {
    const { projectId, cloudVersion } = await req.json();
    if (!projectId) {
        return errorResponse('Missing projectId', 400);
    }
    if (cloudVersion === undefined || cloudVersion === null) {
        return errorResponse('Missing cloudVersion', 400);
    }

    // Check Pro subscription
    const { data: subscription } = await userSupabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();

    const hasAccess = subscription?.status === 'active' || subscription?.status === 'trialing';
    if (!hasAccess) {
        return jsonResponse({ error: 'pro_required', message: 'Pro subscription required.' }, 403);
    }

    // Verify project belongs to user (RLS)
    const { data: rlsCheck } = await userSupabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (!rlsCheck) {
        return errorResponse('Project not found', 404);
    }

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Check shared_videos exists — must share before creating mux video
    const { data: shared } = await adminSupabase
        .from('shared_videos')
        .select('id')
        .eq('project_id', projectId)
        .maybeSingle();

    if (!shared) {
        return errorResponse('Project not shared. Create a share link first.', 400);
    }

    // 2. Get or create mux_video row
    const { data: result, error: rpcError } = await adminSupabase
        .rpc('mux_video_get_or_create', {
            p_project_id: projectId,
            p_user_id: user.id,
            p_cloud_version: cloudVersion,
        })
        .single();

    if (rpcError || !result) {
        console.error('[mux-video-create] mux_video_get_or_create failed:', rpcError);
        return errorResponse('Failed to resolve mux video', 500);
    }

    const muxVideoId = result.mux_video_id;
    console.log(`[mux-video-create] Resolved: status=${result.status}, is_new=${result.is_new}, mux_video_id=${muxVideoId}`);

    // Existing row — return current status
    if (!result.is_new) {
        return jsonResponse({ status: result.status, muxVideoId });
    }

    // 3. New row — call render-start to get/create a render job
    console.log(`[mux-video-create] New mux_video, calling render-start for project ${projectId} v${cloudVersion}`);
    const renderResult = await callRenderStart(adminSupabase, projectId, cloudVersion);

    if (!renderResult) {
        console.error('[mux-video-create] render-start call failed, marking mux_video failed');
        await adminSupabase
            .from('mux_videos')
            .update({ status: 'failed', error: 'Render dispatch failed', updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);
        return errorResponse('Render dispatch failed', 500);
    }

    console.log(`[mux-video-create] render-start returned: jobId=${renderResult.jobId}, status=${renderResult.status}`);

    // If render already completed (cache hit), upload to Mux now
    if (renderResult.status === 'completed' && renderResult.renderStoragePath) {
        console.log(`[mux-video-create] Render already done, uploading to Mux`);
        const uploadResult = await uploadToMux({
            adminSupabase,
            muxVideoId,
            renderStoragePath: renderResult.renderStoragePath,
            muxTokenId: MUX_TOKEN_ID,
            muxTokenSecret: MUX_TOKEN_SECRET,
        });

        if (!uploadResult.success) {
            return errorResponse(uploadResult.error || 'Mux upload failed', 500);
        }

        return jsonResponse({ status: 'pending', muxVideoId });
    }

    // Render is pending — worker will call render-hook, which uploads to Mux
    console.log(`[mux-video-create] Render pending (job ${renderResult.jobId}), waiting for worker`);
    return jsonResponse({ status: 'pending', muxVideoId });
}));

async function callRenderStart(
    adminSupabase: ReturnType<typeof createClient>,
    projectId: string,
    cloudVersion: number,
): Promise<{ jobId: string; status: string; renderStoragePath?: string } | null> {
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/render-start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ projectId, cloudVersion }),
        });
        if (!resp.ok) {
            console.error('[mux-video-create] render-start failed:', resp.status, await resp.text());
            return null;
        }
        return await resp.json();
    } catch (err) {
        console.error('[mux-video-create] render-start dispatch failed:', err);
        return null;
    }
}
