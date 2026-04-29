import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';

/**
 * Project Update Thumbnail Edge Function
 *
 * Accepts a thumbnail blob (image/webp), uploads it to storage,
 * and updates the project's thumbnail_storage_path column.
 *
 * Request:  multipart/form-data with fields: projectId, file (blob)
 * Response: { storagePath }
 */
serve(withAuth(async (req, { user }) => {
    const formData = await req.formData();
    const projectId = formData.get('projectId') as string;
    const file = formData.get('file') as File | null;

    if (!projectId || !file) {
        return errorResponse('Missing projectId or file', 400);
    }

    // Thumbnails should be small — reject anything over 500 KB
    const MAX_THUMBNAIL_BYTES = 500 * 1024;
    if (file.size > MAX_THUMBNAIL_BYTES) {
        return errorResponse(`Thumbnail too large: ${file.size} bytes (max ${MAX_THUMBNAIL_BYTES})`, 413);
    }

    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verify the caller owns this project
    const { data: project, error: fetchError } = await adminSupabase
        .from('projects')
        .select('user_id')
        .eq('id', projectId)
        .maybeSingle();

    if (fetchError || !project) {
        return errorResponse('Project not found', 404);
    }
    if (project.user_id !== user.id) {
        return errorResponse('Forbidden', 403);
    }

    // Upload thumbnail to storage
    const storagePath = `${user.id}/${projectId}/thumbnail.webp`;

    const { error: uploadError } = await adminSupabase
        .storage
        .from(BUCKET)
        .upload(storagePath, file, {
            contentType: 'image/webp',
            upsert: true,
        });

    if (uploadError) {
        console.error('[project-update-thumbnail] Upload failed:', uploadError);
        return errorResponse('Failed to upload thumbnail', 500);
    }

    // Update the project row
    const { error: updateError } = await adminSupabase
        .from('projects')
        .update({ thumbnail_storage_path: storagePath })
        .eq('id', projectId);

    if (updateError) {
        console.error('[project-update-thumbnail] DB update failed:', updateError);
        return errorResponse('Failed to update project', 500);
    }

    return jsonResponse({ storagePath });
}));
