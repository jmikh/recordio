import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';

/**
 * Storage Download URL Edge Function
 *
 * Returns a signed download URL for a file in project-media storage.
 * Verifies the caller owns the file by checking the storage path prefix.
 *
 * Request body: { storagePath }
 * Response:     { signedUrl }
 */
serve(withAuth(async (req, { user }) => {
    const { storagePath } = await req.json();
    if (!storagePath) {
        return errorResponse('Missing storagePath', 400);
    }

    // Verify ownership: storage paths are prefixed with user_id
    if (!storagePath.startsWith(`${user.id}/`)) {
        return errorResponse('Forbidden', 403);
    }

    // Create signed download URL (1 hour expiry)
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: signedData, error: signError } = await adminSupabase
        .storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 3600);

    if (signError || !signedData) {
        console.error('[storage-download-url] Signed URL creation failed:', signError);
        return errorResponse('Failed to create download URL', 500);
    }

    return jsonResponse({ signedUrl: signedData.signedUrl });
}));
