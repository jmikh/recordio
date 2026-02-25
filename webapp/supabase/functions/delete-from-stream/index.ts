import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CF_API_TOKEN = Deno.env.get('CF_STREAM_API_TOKEN')!;
const CF_ACCOUNT_ID = Deno.env.get('CF_STREAM_ACCOUNT_ID')!;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

        // 2. Parse request body
        const { cf_video_uid } = await req.json();
        if (!cf_video_uid || typeof cf_video_uid !== 'string') {
            return new Response(
                JSON.stringify({ error: 'Missing cf_video_uid' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 3. Verify ownership — the video must belong to this user
        const { data: share, error: lookupError } = await supabase
            .from('shared_videos')
            .select('id, user_id')
            .eq('cf_video_uid', cf_video_uid)
            .maybeSingle();

        if (lookupError) {
            console.error('[delete-from-stream] DB lookup error:', lookupError);
        }

        if (!share || share.user_id !== user.id) {
            return new Response(
                JSON.stringify({ error: 'Video not found or not owned by user' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 4. Delete video from Cloudflare Stream
        const cfResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${cf_video_uid}`,
            {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
            }
        );

        if (!cfResponse.ok && cfResponse.status !== 404) {
            // 404 means the video is already gone — treat as success
            const errorText = await cfResponse.text();
            console.error(`[delete-from-stream] CF API error (${cfResponse.status}):`, errorText);
            return new Response(
                JSON.stringify({ error: `Cloudflare deletion failed (${cfResponse.status})` }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        console.error('[delete-from-stream] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
