import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

/**
 * Upload-to-Stream Edge Function (Direct Creator Upload)
 *
 * Uses the `projects` table for share state (cf_video_uid, published_at).
 * Flow:
 *   1. Validates auth + Pro subscription
 *   2. Looks up the project (must exist in projects table)
 *   3. Requests a one-time upload URL from Cloudflare
 *   4. Updates the project row with the new cf_video_uid (published_at stays null until confirmed)
 *   5. Returns { uploadURL, uid, shareId } to the client
 *
 * The client then uploads directly to Cloudflare using the uploadURL.
 */
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Verify Pro subscription
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();

    const hasProAccess = subscription?.status === 'active' || subscription?.status === 'trialing';

    if (!hasProAccess) {
        return jsonResponse({ error: 'pro_required', message: 'Shareable links are a Pro feature.' }, 403);
    }

    // 2. Parse JSON body
    const { projectId, projectName, fileSize } = await req.json();

    if (!projectId || !projectName || !fileSize) {
        return errorResponse('Missing required fields: projectId, projectName, fileSize', 400);
    }

    // 3. Look up the project — must exist and belong to this user (RLS enforced)
    const { data: project } = await supabase
        .from('projects')
        .select('id, cf_video_uid')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (!project) {
        return errorResponse('Project not found', 404);
    }

    const isReshare = !!project.cf_video_uid;

    // 4. Request a TUS upload URL from Cloudflare (Direct Creator Upload via TUS)
    const cfResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream?direct_user=true`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CF_API_TOKEN}`,
                'Tus-Resumable': '1.0.0',
                'Upload-Length': String(fileSize),
                'Upload-Creator': user.id,
                'Upload-Metadata': `maxDurationSeconds ${btoa('3600')}`,
            },
        }
    );

    if (!cfResponse.ok) {
        const cfError = await cfResponse.text();
        console.error('[Stream] CF TUS create failed:', cfError);
        return jsonResponse({ error: 'Failed to create upload URL', details: cfError }, 502);
    }

    const uploadURL = cfResponse.headers.get('Location') || cfResponse.headers.get('location');
    if (!uploadURL) {
        return errorResponse('CF did not return a TUS upload URL', 502);
    }

    // Extract video UID from the TUS URL (last path segment)
    const newVideoUid = cfResponse.headers.get('stream-media-id')
        || uploadURL.split('/').pop() || '';

    // 5. Handle re-share: queue old video for deletion
    if (isReshare && project.cf_video_uid) {
        const adminSupabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        await adminSupabase
            .from('deleted_videos')
            .insert({ cf_video_uid: project.cf_video_uid, source: 'reshare' });
    }

    // 6. Update project with new video UID (published_at stays null until confirm-upload)
    const { error: updateError } = await supabase
        .from('projects')
        .update({
            cf_video_uid: newVideoUid,
            published_at: null,
            name: projectName,
            updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);

    if (updateError) {
        console.error('[Stream] DB update failed:', updateError);
        return errorResponse('Failed to update project', 500);
    }

    return jsonResponse({
        uploadURL,
        uid: newVideoUid,
        shareId: projectId,
        isUpdate: isReshare,
    });
}));
