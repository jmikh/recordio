import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { getProjectIfEditor } from '../_shared/projectAccess.ts';
import { uploadToMux } from '../_shared/muxUpload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID')!;
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET')!;

/**
 * Mux Video Create Edge Function
 *
 * Auth: User JWT (via withAuth).
 * Creates or resolves a mux_video row for a specific cloud_version.
 * If the render is already done, uploads to Mux immediately.
 *
 * Request body: { projectId, cloudVersion }
 * Response:     { status, muxVideoId? }
 */
serve(withAuth(async (req, { user }) => {
    const { projectId, cloudVersion } = await req.json();
    if (!projectId) {
        return errorResponse('Missing projectId', 400);
    }
    if (cloudVersion === undefined || cloudVersion === null) {
        return errorResponse('Missing cloudVersion', 400);
    }

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify caller has editor access (owner or explicit editor)
    const rlsCheck = await getProjectIfEditor(adminSupabase, projectId, user.id, ['slug', 'owner_id']);
    if (!rlsCheck) {
        return errorResponse('Project not found or access denied', 404);
    }

    if (!rlsCheck.slug) {
        return errorResponse('Project not shared. Create a share link first.', 400);
    }

    const ownerId = rlsCheck.owner_id;

    // 2. Get or create mux_video row
    const { data: result, error: rpcError } = await adminSupabase
        .rpc('mux_video_get_or_create', {
            p_project_id: projectId,
            p_user_id: ownerId,
            p_cloud_version: cloudVersion,
        })
        .single();

    if (rpcError) throw new Error('mux_video_get_or_create failed', { cause: rpcError });
    if (!result) throw new Error('mux_video_get_or_create returned null');

    const muxVideoId = result.mux_video_id;
    console.log(`[mux-video-create] Resolved: status=${result.status}, is_new=${result.is_new}, mux_video_id=${muxVideoId}`);

    // Existing row — return current status
    if (!result.is_new) {
        return jsonResponse({ status: result.status, muxVideoId });
    }

    // 3. New row — call render-job-create to get/create a render job.
    // On failure: mark the mux_video failed in DB before rethrowing so the row
    // doesn't sit in 'pending' forever.
    console.log(`[mux-video-create] New mux_video, calling render-job-create for project ${projectId} v${cloudVersion}`);

    let renderResult: { jobId: string; status: string; renderStoragePath?: string };
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/render-job-create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'x-service-role-key': SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({ projectId, cloudVersion }),
        });
        if (!resp.ok) throw new Error(`render-job-create returned ${resp.status}: ${await resp.text()}`);
        renderResult = await resp.json();
    } catch (err) {
        await adminSupabase
            .from('mux_videos')
            .update({ status: 'failed', error: 'Render dispatch failed', updated_at: new Date().toISOString() })
            .eq('id', muxVideoId);
        throw err;
    }

    console.log(`[mux-video-create] render-job-create returned: jobId=${renderResult.jobId}, status=${renderResult.status}`);

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
            throw new Error(`Mux upload failed: ${uploadResult.error ?? 'unknown'}`);
        }

        return jsonResponse({ status: 'pending', muxVideoId });
    }

    // Render is pending — worker will call render-job-hook, which uploads to Mux
    console.log(`[mux-video-create] Render pending (job ${renderResult.jobId}), waiting for worker`);
    return jsonResponse({ status: 'pending', muxVideoId });
}));
