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
 * Request:  { project, name?, workspaceId }
 * Response: { projectId, uploads: [{ fileType, storagePath, signedUrl }] }
 */
serve(withAuth(async (req, { user }) => {
    // deno-lint-ignore no-explicit-any
    const { project, name, workspaceId } = await req.json() as { project: any; name?: string; workspaceId?: string };

    if (!workspaceId) {
        return errorResponse('Missing workspaceId', 400);
    }

    if (!project || !project.id) {
        return errorResponse('Missing project or project.id', 400);
    }

    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Determine which media files exist and generate storage paths
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

    // 2. Check workspace subscription to determine if project should expire
    const { data: sub } = await adminSupabase
        .from('subscriptions')
        .select('status')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    const hasActiveSub = sub?.status === 'active' || sub?.status === 'past_due';

    // 3. Save project to DB with upload_status='pending'
    const durationMs = project.timeline?.durationMs
        ? Math.round(project.timeline.durationMs)
        : null;

    console.log(`[project-create] Upserting project ${projectId} into workspace ${workspaceId}`);
    const { error: upsertError } = await adminSupabase
        .from('projects')
        .upsert({
            id: projectId,
            workspace_id: workspaceId,
            created_by: user.id,
            owner_id: user.id,
            name: name ?? 'Untitled',
            project_data: project,
            upload_status: 'pending',
            duration_ms: durationMs,
            expires_at: hasActiveSub ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });

    if (upsertError) throw new Error('projects upsert failed', { cause: upsertError });
    console.log(`[project-create] Upsert done, generating S3 presigned URLs for ${mediaFiles.length} files`);

    // 4. Create S3 presigned upload URLs for each media file
    const uploads: { fileType: string; storagePath: string; signedUrl: string }[] = [];

    await Promise.all(mediaFiles.map(async (mf) => {
        const command = new PutObjectCommand({ Bucket: BUCKET, Key: mf.storagePath });
        const signedUrl = await getS3SignedUrl(s3, command, { expiresIn: 3600 });
        uploads.push({ fileType: mf.fileType, storagePath: mf.storagePath, signedUrl });
    }));

    console.log(`[project-create] Done, returning ${uploads.length} upload URLs`);
    return jsonResponse({ projectId, uploads });
}));
