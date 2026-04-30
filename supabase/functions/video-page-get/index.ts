import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;

/**
 * Video Page Get (public, no auth required)
 *
 * Resolves a slug to video page data. Uses service role to bypass RLS.
 * Always returns project name + user display name when share exists.
 * Returns mux_playback_id only when video is ready.
 * Never leaks project_id, user_id, or internal IDs.
 *
 * Request body: { slug }
 * Response:     { status, name, user_name, mux_playback_id? }
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

        // 1. Resolve slug -> shared_videos row
        const { data: share, error: shareError } = await adminSupabase
            .from('shared_videos')
            .select('project_id, user_id, policy')
            .eq('slug', slug)
            .maybeSingle();

        if (shareError || !share) {
            return errorResponse('not_found', 404);
        }

        // 2. Check share policy
        if (share.policy !== 'public') {
            return errorResponse('not_found', 404);
        }

        const projectId = share.project_id;

        // 3. Get project name and cloud_version
        const { data: project, error: projectError } = await adminSupabase
            .from('projects')
            .select('name, cloud_version')
            .eq('id', projectId)
            .is('deleted_at', null)
            .maybeSingle();

        if (projectError || !project) {
            return errorResponse('not_found', 404);
        }

        // 4. Get user display name from auth
        const { data: { user: authUser } } = await adminSupabase.auth.admin.getUserById(share.user_id);
        const userName = authUser?.user_metadata?.full_name
            ?? authUser?.user_metadata?.name
            ?? authUser?.email
            ?? 'Unknown';

        // 5. Query latest active completed mux_video
        const { data: muxVideo } = await adminSupabase
            .from('mux_videos')
            .select('mux_playback_id, cloud_version')
            .eq('project_id', projectId)
            .eq('status', 'completed')
            .eq('is_deleted', false)
            .maybeSingle();

        // 6. If completed mux_video exists with current cloud_version -> ready
        if (muxVideo?.mux_playback_id && muxVideo.cloud_version === project.cloud_version) {
            return jsonResponse({
                status: 'ready',
                name: project.name,
                user_name: userName,
                mux_playback_id: muxVideo.mux_playback_id,
            });
        }

        // 7. If completed but stale -> return stale video + silently trigger re-upload
        if (muxVideo?.mux_playback_id) {
            fetch(`${SUPABASE_URL}/functions/v1/mux-video-upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${RENDER_SECRET}`,
                },
                body: JSON.stringify({ projectId }),
            }).catch(err => {
                console.error('[video-page-get] mux-video-upload dispatch failed:', err);
            });

            return jsonResponse({
                status: 'ready',
                name: project.name,
                user_name: userName,
                mux_playback_id: muxVideo.mux_playback_id,
            });
        }

        // 8. No ready video — fire-and-forget mux-video-upload (idempotent)
        fetch(`${SUPABASE_URL}/functions/v1/mux-video-upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RENDER_SECRET}`,
            },
            body: JSON.stringify({ projectId }),
        }).catch(err => {
            console.error('[video-page-get] mux-video-upload dispatch failed:', err);
        });

        return jsonResponse({
            status: 'processing',
            name: project.name,
            user_name: userName,
        });
    } catch (err) {
        console.error('[video-page-get] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
