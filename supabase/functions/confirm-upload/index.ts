import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

/**
 * Confirm-Upload Edge Function
 *
 * Called by the client after a successful direct upload to Cloudflare Stream.
 * Sets published_at on the projects row, making the video visible on the
 * watch page and dashboard.
 */
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Parse request body — shareId is the project ID
    const { shareId } = await req.json();
    if (!shareId) {
        return errorResponse('Missing shareId', 400);
    }

    // 2. Set published_at to mark the upload as complete
    //    Only transition from null → set (uploading → published)
    const { error: updateError } = await supabase
        .from('projects')
        .update({
            published_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', shareId)
        .eq('user_id', user.id)
        .is('published_at', null)
        .not('cf_video_uid', 'is', null);

    if (updateError) {
        console.error('[confirm-upload] DB update failed:', updateError);
        return errorResponse('Failed to confirm upload', 500);
    }

    return jsonResponse({ success: true });
}));
