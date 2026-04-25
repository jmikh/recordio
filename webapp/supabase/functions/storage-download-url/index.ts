import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

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
serve(withAuth(async (req, { user }) => {
    // 1. Parse request
    const { storagePath } = await req.json();

    if (!storagePath) {
        return errorResponse('Missing storagePath', 400);
    }

    // 2. Verify the path belongs to this user (path format: {userId}/{projectId}/file.ext)
    if (!storagePath.startsWith(`${user.id}/`)) {
        return errorResponse('Forbidden', 403);
    }

    // 3. Create signed download URL (1 hour expiry)
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
        return errorResponse('Failed to create download URL', 500);
    }

    return jsonResponse({ signedUrl: signedData.signedUrl });
}));
