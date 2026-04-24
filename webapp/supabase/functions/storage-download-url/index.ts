import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'project-media';

/**
 * Storage Download URL Edge Function
 *
 * Validates JWT + project ownership, returns a signed download URL.
 * The client downloads directly from Storage using the signed URL.
 *
 * Request body: { storagePath }
 * Response:     { signedUrl }
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
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } },
        );

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 2. Parse request
        const { storagePath } = await req.json();

        if (!storagePath) {
            return new Response(
                JSON.stringify({ error: 'Missing storagePath' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 3. Verify the path belongs to this user (path format: {userId}/{projectId}/file.ext)
        if (!storagePath.startsWith(`${user.id}/`)) {
            return new Response(
                JSON.stringify({ error: 'Forbidden' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 4. Create signed download URL (1 hour expiry)
        const adminSupabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const { data: signedData, error: signError } = await adminSupabase
            .storage
            .from(BUCKET)
            .createSignedUrl(storagePath, 3600); // 1 hour

        if (signError || !signedData) {
            console.error('[storage-download-url] Signed URL creation failed:', signError);
            return new Response(
                JSON.stringify({ error: 'Failed to create download URL' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        return new Response(
            JSON.stringify({ signedUrl: signedData.signedUrl }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (err) {
        console.error('[storage-download-url] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
