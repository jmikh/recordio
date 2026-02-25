import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

const MAX_SHARED_VIDEOS = 5;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Verify auth (same pattern as other Edge Functions)
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

        // 2.5. Verify Pro subscription (defense-in-depth — UI also gates this)
        const { data: subscription } = await supabase
            .from('subscriptions')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle();

        const hasProAccess = subscription?.status === 'active' || subscription?.status === 'trialing';

        // Also check free trial
        const { data: metadata } = await supabase
            .from('user_metadata')
            .select('free_trial_until')
            .eq('id', user.id)
            .maybeSingle();

        const hasFreeTrial = metadata?.free_trial_until && new Date(metadata.free_trial_until) > new Date();

        if (!hasProAccess && !hasFreeTrial) {
            return new Response(
                JSON.stringify({ error: 'pro_required', message: 'Shareable links are a Pro feature.' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Parse multipart form data
        const formData = await req.formData();
        const videoFile = formData.get('video') as File;
        const projectId = formData.get('projectId') as string;
        const projectName = formData.get('projectName') as string;

        if (!videoFile || !projectId || !projectName) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: video, projectId, projectName' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Check for existing share (re-share case)
        const { data: existingShare } = await supabase
            .from('shared_videos')
            .select('id, cf_video_uid, version')
            .eq('user_id', user.id)
            .eq('project_id', projectId)
            .single();

        // 4. Check quota (only if this is a new share, not a re-share)
        if (!existingShare) {
            const { count } = await supabase
                .from('shared_videos')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user.id);

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

        // 5. Upload to Cloudflare Stream
        const cfFormData = new FormData();
        cfFormData.append('file', videoFile, `${projectName}.mp4`);

        const cfResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
                body: cfFormData,
            }
        );

        if (!cfResponse.ok) {
            const cfError = await cfResponse.text();
            console.error('[Stream] CF upload failed:', cfError);
            return new Response(
                JSON.stringify({ error: 'Upload to video service failed', details: cfError }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const cfData = await cfResponse.json();
        const newVideoUid = cfData.result.uid;

        // 6. Upsert shared_videos record
        const oldVideoUid = existingShare?.cf_video_uid;

        if (existingShare) {
            // Re-share: update existing record
            const { error: updateError } = await supabase
                .from('shared_videos')
                .update({
                    cf_video_uid: newVideoUid,
                    project_name: projectName,
                    version: (existingShare.version || 1) + 1,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingShare.id);

            if (updateError) {
                console.error('[Stream] DB update failed:', updateError);
                await deleteCloudflareVideo(newVideoUid);
                return new Response(
                    JSON.stringify({ error: 'Failed to update share record' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 7. Safe delete: remove OLD video only after successful DB update
            if (oldVideoUid && oldVideoUid !== newVideoUid) {
                await deleteCloudflareVideo(oldVideoUid);
            }

            return new Response(JSON.stringify({
                shareId: existingShare.id,
                videoUid: newVideoUid,
                version: (existingShare.version || 1) + 1,
                isUpdate: true,
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } else {
            // New share: insert
            const { data: newShare, error: insertError } = await supabase
                .from('shared_videos')
                .insert({
                    user_id: user.id,
                    project_id: projectId,
                    project_name: projectName,
                    cf_video_uid: newVideoUid,
                })
                .select('id')
                .single();

            if (insertError) {
                console.error('[Stream] DB insert failed:', insertError);
                await deleteCloudflareVideo(newVideoUid);
                return new Response(
                    JSON.stringify({ error: 'Failed to create share record' }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(JSON.stringify({
                shareId: newShare.id,
                videoUid: newVideoUid,
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

/** Best-effort delete of a Cloudflare Stream video */
async function deleteCloudflareVideo(videoUid: string): Promise<void> {
    try {
        const resp = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${videoUid}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
            }
        );
        if (!resp.ok) {
            console.error(`[Stream] Failed to delete CF video ${videoUid}:`, await resp.text());
        }
    } catch (e) {
        console.error(`[Stream] Error deleting CF video ${videoUid}:`, e);
    }
}
