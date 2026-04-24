import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'project-media';

/**
 * Storage Upload URL Edge Function
 *
 * Validates JWT + project ownership + quota, then returns a signed upload URL
 * for direct upload to Supabase Storage. The client uploads directly using the
 * signed URL — no blob passes through this function.
 *
 * Request body: { projectId, fileType: 'screen'|'camera'|'mic'|'thumbnail', sizeBytes }
 * Response:     { signedUrl, token, storagePath }
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
        const { projectId, fileType, sizeBytes } = await req.json();

        if (!projectId || !fileType) {
            return new Response(
                JSON.stringify({ error: 'Missing projectId or fileType' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const validTypes = ['screen', 'camera', 'mic', 'thumbnail'];
        if (!validTypes.includes(fileType)) {
            return new Response(
                JSON.stringify({ error: `Invalid fileType. Must be one of: ${validTypes.join(', ')}` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 3. Verify project ownership (RLS will enforce this, but be explicit)
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, user_id')
            .eq('id', projectId)
            .maybeSingle();

        if (projectError || !project) {
            return new Response(
                JSON.stringify({ error: 'Project not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 4. Check quota (skip for thumbnails — they're tiny)
        if (fileType !== 'thumbnail' && sizeBytes) {
            const adminSupabase = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            );

            const { data: usedBytes } = await adminSupabase
                .rpc('get_user_storage_bytes', { p_user_id: user.id });

            const { data: quota } = await adminSupabase
                .from('user_quotas')
                .select('storage_limit_bytes')
                .eq('user_id', user.id)
                .maybeSingle();

            const limitBytes = quota?.storage_limit_bytes ?? 26843545600; // 25 GB default

            if ((usedBytes ?? 0) + sizeBytes > limitBytes) {
                return new Response(
                    JSON.stringify({
                        error: 'quota_exceeded',
                        message: 'Storage quota exceeded',
                        usedBytes: usedBytes ?? 0,
                        limitBytes,
                    }),
                    { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }
        }

        // 5. Build storage path and create signed upload URL
        const ext = fileType === 'thumbnail' ? 'webp'
            : fileType === 'mic' ? 'wav'
            : 'webm';
        const storagePath = `${user.id}/${projectId}/${fileType}.${ext}`;

        // Use admin client to create signed URL (bypasses RLS on storage)
        const adminSupabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const { data: signedData, error: signError } = await adminSupabase
            .storage
            .from(BUCKET)
            .createSignedUploadUrl(storagePath, { upsert: true });

        if (signError || !signedData) {
            console.error('[storage-upload-url] Signed URL creation failed:', signError);
            return new Response(
                JSON.stringify({ error: 'Failed to create upload URL' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        return new Response(
            JSON.stringify({
                signedUrl: signedData.signedUrl,
                token: signedData.token,
                storagePath,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (err) {
        console.error('[storage-upload-url] Unexpected error:', err);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
