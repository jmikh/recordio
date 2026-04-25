import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

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
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Parse request
    const { projectId, fileType, sizeBytes } = await req.json();

    if (!projectId || !fileType) {
        return errorResponse('Missing projectId or fileType', 400);
    }

    const validTypes = ['screen', 'camera', 'mic', 'thumbnail'];
    if (!validTypes.includes(fileType)) {
        return errorResponse(`Invalid fileType. Must be one of: ${validTypes.join(', ')}`, 400);
    }

    // 2. Verify project ownership (RLS will enforce this, but be explicit)
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, user_id')
        .eq('id', projectId)
        .maybeSingle();

    if (projectError || !project) {
        return errorResponse('Project not found', 404);
    }

    // 3. Check quota (skip for thumbnails — they're tiny)
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
            return jsonResponse({
                error: 'quota_exceeded',
                message: 'Storage quota exceeded',
                usedBytes: usedBytes ?? 0,
                limitBytes,
            }, 413);
        }
    }

    // 4. Build storage path and create signed upload URL
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
        return errorResponse('Failed to create upload URL', 500);
    }

    return jsonResponse({
        signedUrl: signedData.signedUrl,
        token: signedData.token,
        storagePath,
    });
}));
