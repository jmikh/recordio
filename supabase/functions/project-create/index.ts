import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import { getSignedUrl as getS3SignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';

const s3 = new S3Client({
    forcePathStyle: true,
    region: Deno.env.get('S3_REGION') ?? '',
    endpoint: Deno.env.get('S3_ENDPOINT') ?? '',
    credentials: {
        accessKeyId: Deno.env.get('S3_ACCESS_KEY') ?? '',
        secretAccessKey: Deno.env.get('S3_SECRET_KEY') ?? '',
    },
});

const EXT_MAP: Record<string, string> = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
};

/**
 * Project Upload Edge Function
 *
 * Takes a full project struct, generates storage paths for all media,
 * stamps them into the project, saves it to DB with upload_status='pending',
 * and returns signed upload URLs for each media file.
 *
 * The client uploads blobs directly to Storage, then calls the
 * project_confirm_upload RPC to flip status to 'ready'.
 *
 * Request:  { project, isPro? }
 * Response: { projectId, uploads: [{ fileType, storagePath, signedUrl }] }
 */
serve(withAuth(async (req, { user, supabase }) => {
    // deno-lint-ignore no-explicit-any
    const { project, name, isPro } = await req.json() as { project: any; name?: string; isPro?: boolean };

    if (!project || !project.id) {
        return errorResponse('Missing project or project.id', 400);
    }

    // 1. Check quota — just current usage vs limit, no file size math
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

    if ((usedBytes ?? 0) >= limitBytes) {
        return jsonResponse({
            error: 'quota_exceeded',
            message: 'Storage quota exceeded',
            usedBytes: usedBytes ?? 0,
            limitBytes,
        }, 413);
    }

    // 2. Determine which media files exist and generate storage paths
    const projectId = project.id;
    const mediaFiles: { fileType: string; storagePath: string }[] = [];

    if (project.screenSource) {
        const sp = `${user.id}/${projectId}/screen.${EXT_MAP.screen}`;
        project.screenSource.storagePath = sp;
        mediaFiles.push({ fileType: 'screen', storagePath: sp });
    }
    if (project.cameraSource) {
        const sp = `${user.id}/${projectId}/camera.${EXT_MAP.camera}`;
        project.cameraSource.storagePath = sp;
        mediaFiles.push({ fileType: 'camera', storagePath: sp });
    }
    if (project.microphoneSource) {
        const sp = `${user.id}/${projectId}/mic.${EXT_MAP.mic}`;
        project.microphoneSource.storagePath = sp;
        mediaFiles.push({ fileType: 'mic', storagePath: sp });
    }

    // 3. Save project to DB with upload_status='pending'
    const { error: upsertError } = await adminSupabase
        .from('projects')
        .upsert({
            id: projectId,
            user_id: user.id,
            name: name ?? 'Untitled',
            project_data: project,
            upload_status: 'pending',
            expires_at: isPro ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });

    if (upsertError) {
        console.error('[project-upload] Upsert failed:', upsertError);
        return errorResponse('Failed to save project', 500);
    }

    // 4. Create S3 presigned upload URLs for each media file
    const uploads: { fileType: string; storagePath: string; signedUrl: string }[] = [];

    try {
        await Promise.all(mediaFiles.map(async (mf) => {
            const command = new PutObjectCommand({ Bucket: BUCKET, Key: mf.storagePath });
            const signedUrl = await getS3SignedUrl(s3, command, { expiresIn: 3600 });
            uploads.push({ fileType: mf.fileType, storagePath: mf.storagePath, signedUrl });
        }));
    } catch (err) {
        console.error('[project-upload] S3 presign failed:', err);
        return errorResponse('Failed to create upload URLs', 500);
    }

    return jsonResponse({ projectId, uploads });
}));
