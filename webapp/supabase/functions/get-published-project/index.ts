import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

/**
 * Get Published Project (public, no auth required)
 *
 * Returns limited project metadata for the watch page.
 * Uses service role to bypass RLS since the caller is unauthenticated.
 * Only returns projects that are published (cf_video_uid + published_at set).
 */
serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { projectId } = await req.json();
        if (!projectId) {
            return new Response(
                JSON.stringify({ error: 'Missing projectId' }),
                { status: 400, headers: jsonHeaders },
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const { data, error } = await supabase
            .from('projects')
            .select('id, user_id, name, cf_video_uid, share_description, published_at, updated_at')
            .eq('id', projectId)
            .not('cf_video_uid', 'is', null)
            .not('published_at', 'is', null)
            .is('deleted_at', null)
            .maybeSingle();

        if (error) {
            console.error('[get-published-project] DB error:', error);
            return new Response(
                JSON.stringify({ error: 'Failed to fetch project' }),
                { status: 500, headers: jsonHeaders },
            );
        }

        if (!data) {
            return new Response(
                JSON.stringify({ error: 'not_found' }),
                { status: 404, headers: jsonHeaders },
            );
        }

        return new Response(
            JSON.stringify({ project: data }),
            { status: 200, headers: jsonHeaders },
        );
    } catch (err) {
        console.error('[get-published-project] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: jsonHeaders },
        );
    }
});
