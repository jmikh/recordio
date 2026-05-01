import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Shared Video Get (public, no auth required)
 *
 * Read-only — resolves a slug to video page data.
 * Always returns project name + user display name when share exists.
 * No dispatching — just returns current state.
 *
 * Mux video lookup priority:
 *   1. Latest completed (highest cloud_version, not deleted) → return playback_id
 *   2. Latest pending → return status 'pending'
 *   3. Any failed → return status 'failed'
 *   4. No mux_video → return without mux data (frontend shows "Could not find video")
 *
 * Request body: { slug }
 * Response:     { status, name, userName, muxPlaybackId? }
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { slug } = await req.json();
        if (!slug) {
            return errorResponse('Missing slug', 400);
        }

        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // 1. Resolve slug → project
        const { data: project, error: projectError } = await adminSupabase
            .from('projects')
            .select('id, name, user_id, share_policy')
            .eq('slug', slug)
            .is('deleted_at', null)
            .maybeSingle();

        if (projectError || !project) {
            return errorResponse('not_found', 404);
        }

        if (project.share_policy !== 'public') {
            return errorResponse('not_found', 404);
        }

        const projectId = project.id;

        // 2. Get user display name
        const { data: { user: authUser } } = await adminSupabase.auth.admin.getUserById(project.user_id);
        const userName = authUser?.user_metadata?.full_name
            ?? authUser?.user_metadata?.name
            ?? authUser?.email
            ?? 'Unknown';

        // Base response — always includes project info
        const baseResponse = { name: project.name, userName };

        // 4. Mux video lookup — priority: completed → pending → failed
        // 4a. Latest completed (highest cloud_version, not deleted)
        const { data: completed } = await adminSupabase
            .from('mux_videos')
            .select('mux_playback_id, cloud_version')
            .eq('project_id', projectId)
            .eq('status', 'completed')
            .order('cloud_version', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (completed?.mux_playback_id) {
            return jsonResponse({
                ...baseResponse,
                status: 'completed',
                muxPlaybackId: completed.mux_playback_id,
            });
        }

        // 4b. Latest pending
        const { data: pending } = await adminSupabase
            .from('mux_videos')
            .select('id')
            .eq('project_id', projectId)
            .eq('status', 'pending')
            .order('cloud_version', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (pending) {
            return jsonResponse({ ...baseResponse, status: 'pending' });
        }

        // 4c. Any failed
        const { data: failed } = await adminSupabase
            .from('mux_videos')
            .select('id')
            .eq('project_id', projectId)
            .eq('status', 'failed')
            .limit(1)
            .maybeSingle();

        if (failed) {
            return jsonResponse({ ...baseResponse, status: 'failed' });
        }

        // 4d. No mux_video at all
        return jsonResponse(baseResponse);
    } catch (err) {
        console.error('[shared-video-get] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
