import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

/**
 * Delete-from-Stream Edge Function (Unpublish)
 *
 * Clears the publish columns on the projects row and queues the
 * Cloudflare Stream video for async deletion via deleted_videos.
 */
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Parse request body
    const { cf_video_uid } = await req.json();
    if (!cf_video_uid || typeof cf_video_uid !== 'string') {
        return errorResponse('Missing cf_video_uid', 400);
    }

    // 2. Verify ownership via projects table (RLS scopes to user's own projects)
    const { data: project, error: lookupError } = await supabase
        .from('projects')
        .select('id')
        .eq('cf_video_uid', cf_video_uid)
        .maybeSingle();

    if (lookupError) {
        console.error('[delete-from-stream] DB lookup error:', lookupError);
    }

    if (!project) {
        return errorResponse('Video not found or not owned by user', 403);
    }

    // 3. Queue for async CF deletion (instant — no CF API call)
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { error: queueError } = await adminSupabase
        .from('deleted_videos')
        .insert({ cf_video_uid, source: 'user_delete' });

    if (queueError) {
        console.error('[delete-from-stream] Failed to queue deletion:', queueError);
        return errorResponse('Failed to queue video for deletion', 500);
    }

    // 4. Clear publish columns on the project
    const { error: clearError } = await supabase
        .from('projects')
        .update({
            cf_video_uid: null,
            published_at: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', project.id);

    if (clearError) {
        console.error('[delete-from-stream] Failed to clear publish columns:', clearError);
        // Don't fail the request — the video is already queued for deletion
    }

    return jsonResponse({ success: true });
}));
