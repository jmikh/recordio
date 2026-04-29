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
 * Two modes:
 *   Existing: { storagePath }
 *   Enum:     { projectId, fileType: 'render' }
 *
 * Response: { signedUrl }
 */
serve(withAuth(async (req, { user, supabase }) => {
    const body = await req.json();
    const { storagePath: rawStoragePath, projectId, fileType } = body;

    let storagePath: string;

    if (projectId && fileType) {
        // Enum mode — build path internally
        // Verify project ownership via RLS
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .is('deleted_at', null)
            .maybeSingle();

        if (projectError || !project) {
            return errorResponse('Project not found', 404);
        }

        const pathMap: Record<string, string> = {
            render: `${user.id}/${projectId}/render_1080p.mp4`,
        };

        storagePath = pathMap[fileType];
        if (!storagePath) {
            return errorResponse(`Invalid fileType. Must be one of: ${Object.keys(pathMap).join(', ')}`, 400);
        }
    } else if (rawStoragePath) {
        // Legacy mode — raw storage path
        if (!rawStoragePath.startsWith(`${user.id}/`)) {
            return errorResponse('Forbidden', 403);
        }
        storagePath = rawStoragePath;
    } else {
        return errorResponse('Missing storagePath or (projectId + fileType)', 400);
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
