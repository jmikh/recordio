import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

const MAX_SHARED_VIDEOS = 10;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Upload-to-Stream Edge Function (Direct Creator Upload)
 *
 * Instead of receiving the full video blob, this function:
 * 1. Validates auth + Pro subscription
 * 2. Checks quota
 * 3. Requests a one-time upload URL from Cloudflare
 * 4. Creates/updates the shared_videos DB record with status='uploading'
 * 5. Returns { uploadURL, uid, shareId } to the client
 *
 * The client then uploads directly to Cloudflare using the uploadURL.
 */
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Verify auth
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized: Missing auth header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized: Invalid user' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 2. Verify Pro subscription
        const { data: subscription } = await supabase
            .from('subscriptions')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle();

        const hasProAccess = subscription?.status === 'active' || subscription?.status === 'trialing';

        if (!hasProAccess) {
            return new Response(
                JSON.stringify({ error: 'pro_required', message: 'Shareable links are a Pro feature.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Parse JSON body (no more FormData with video blob)
        const { projectId, projectName } = await req.json();

        if (!projectId || !projectName) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: projectId, projectName' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 4. Check for existing share (re-share case)
        const { data: existingShare } = await supabase
            .from('shared_videos')
            .select('id, cf_video_uid, version')
            .eq('user_id', user.id)
            .eq('project_id', projectId)
            .single();

        // 5. Check quota (only if this is a new share, not a re-share)
        if (!existingShare) {
            const { count } = await supabase
                .from('shared_videos')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('status', 'ready');

            if (count !== null && count >= MAX_SHARED_VIDEOS) {
                return new Response(JSON.stringify({
                    error: 'quota_exceeded',
                    message: `You've reached the limit of ${MAX_SHARED_VIDEOS} shared videos. Delete an existing share to free up a slot.`,
                    current: count,
                    max: MAX_SHARED_VIDEOS,
                }), {
                    status: 429,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
        }

        // 6. Request a one-time upload URL from Cloudflare (Direct Creator Upload)
        const cfResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/direct_upload`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CF_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    maxDurationSeconds: 3600,
                    creator: user.id,
                }),
            }
        );

        if (!cfResponse.ok) {
            const cfError = await cfResponse.text();
            console.error('[Stream] CF direct_upload request failed:', cfError);
            return new Response(
                JSON.stringify({ error: 'Failed to create upload URL', details: cfError }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const cfData = await cfResponse.json();
        const uploadURL = cfData.result.uploadURL;
        const newVideoUid = cfData.result.uid;

        // 7. Handle re-share: move old video to deletion queue
        const creatorName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'A Recordio user';

        if (existingShare) {
            // Queue old video for deletion
            if (existingShare.cf_video_uid) {
                const adminSupabase = createClient(
                    Deno.env.get('SUPABASE_URL') ?? '',
                    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
                );
                await adminSupabase
                    .from('deleted_videos')
                    .insert({ cf_video_uid: existingShare.cf_video_uid, source: 'reshare' });
            }

            // Update existing record with new video UID, set status to uploading
            const { error: updateError } = await supabase
                .from('shared_videos')
                .update({
                    cf_video_uid: newVideoUid,
                    project_name: projectName,
                    creator_name: creatorName,
                    version: (existingShare.version || 1) + 1,
                    status: 'uploading',
                    upload_started_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingShare.id);

            if (updateError) {
                console.error('[Stream] DB update failed:', updateError);
                return new Response(
                    JSON.stringify({ error: 'Failed to update share record' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(JSON.stringify({
                uploadURL,
                uid: newVideoUid,
                shareId: existingShare.id,
                version: (existingShare.version || 1) + 1,
                isUpdate: true,
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } else {
            // New share: insert with status='uploading'
            const { data: newShare, error: insertError } = await supabase
                .from('shared_videos')
                .insert({
                    user_id: user.id,
                    project_id: projectId,
                    project_name: projectName,
                    creator_name: creatorName,
                    cf_video_uid: newVideoUid,
                    status: 'uploading',
                    upload_started_at: new Date().toISOString(),
                })
                .select('id')
                .single();

            if (insertError) {
                console.error('[Stream] DB insert failed:', insertError);
                return new Response(
                    JSON.stringify({ error: 'Failed to create share record' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(JSON.stringify({
                uploadURL,
                uid: newVideoUid,
                shareId: newShare.id,
                version: 1,
                isUpdate: false,
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    } catch (error) {
        console.error('[Stream] Unexpected error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
