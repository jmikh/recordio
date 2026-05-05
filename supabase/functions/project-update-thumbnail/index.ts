import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';

// Server-side uploads from edge functions run inside Docker, so they need
// S3_ENDPOINT_INTERNAL (e.g. http://host.docker.internal:9000) to reach MinIO.
// Falls back to S3_ENDPOINT for production where there's no Docker split.
const s3 = new S3Client({
    forcePathStyle: true,
    region: Deno.env.get('S3_REGION') ?? '',
    endpoint: Deno.env.get('S3_ENDPOINT_INTERNAL') ?? Deno.env.get('S3_ENDPOINT') ?? '',
    credentials: {
        accessKeyId: Deno.env.get('S3_ACCESS_KEY') ?? '',
        secretAccessKey: Deno.env.get('S3_SECRET_KEY') ?? '',
    },
});

/**
 * Project Update Thumbnail Edge Function
 *
 * Accepts a thumbnail blob (image/webp), uploads it to S3 storage,
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

    // Upload thumbnail to S3 storage
    const storagePath = `${user.id}/${projectId}/thumbnail.webp`;
    const fileBuffer = await file.arrayBuffer();

    try {
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: storagePath,
            Body: new Uint8Array(fileBuffer),
            ContentType: 'image/webp',
        }));
    } catch (err) {
        console.error('[project-update-thumbnail] S3 upload failed:', err);
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
