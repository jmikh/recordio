import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import { getSignedUrl as getS3SignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';
const PART_SIZE = 16 * 1024 * 1024; // 16 MiB

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

const CONTENT_TYPE_MAP: Record<string, string> = {
    screen: 'video/webm',
    camera: 'video/webm',
    mic: 'audio/wav',
};

/**
 * Project Upload v2 — S3 multipart variant.
 *
 * Like v1, but instead of one presigned PUT per file, initiates an S3 multipart
 * upload and presigns N UploadPart URLs (one per 16 MiB chunk). The client
 * uploads parts in parallel directly to S3 — each part is small enough to
 * comfortably finish under the Cloudflare 100s proxy timeout, and parallelism
 * keeps total upload speed high.
 *
 * After all parts succeed, the client calls `project-multipart-complete` with
 * the uploadId + collected part ETags per file. That edge function runs
 * CompleteMultipartUpload server-side (the AWS SDK adds a SigV4 Authorization
 * header automatically, which Supabase's S3 protocol requires for this op —
 * presigned URLs can't satisfy that header requirement from the browser).
 *
 * Request:
 *   {
 *     project, name?, workspaceId,
 *     fileSizes: { screen?: number, camera?: number, mic?: number }   // bytes
 *   }
 *
 * Response:
 *   {
 *     projectId,
 *     bucket,
 *     partSize,
 *     uploads: [{ fileType, storagePath, uploadId, partUrls: string[] }]
 *   }
 */
serve(withAuth('project-create-v2', async (req, { user }) => {
    // deno-lint-ignore no-explicit-any
    const { project, name, workspaceId, fileSizes } = await req.json() as {
        // deno-lint-ignore no-explicit-any
        project: any;
        name?: string;
        workspaceId?: string;
        fileSizes?: Record<string, number>;
    };

    if (!workspaceId) return errorResponse('Missing workspaceId', 400);
    if (!project || !project.id) return errorResponse('Missing project or project.id', 400);
    if (!fileSizes) return errorResponse('Missing fileSizes', 400);

    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Determine which media files exist and generate storage paths
    const projectId = project.id;
    const mediaFiles: { fileType: string; storagePath: string; size: number }[] = [];

    const addMediaFile = (fileType: string, source: { storagePath: string } | undefined) => {
        if (!source) return;
        const size = fileSizes[fileType];
        if (typeof size !== 'number' || size <= 0) {
            throw new Error(`Missing or invalid fileSizes.${fileType}`);
        }
        const sp = `${user.id}/${projectId}/${fileType === 'mic' ? 'mic' : fileType}.${EXT_MAP[fileType]}`;
        source.storagePath = sp;
        mediaFiles.push({ fileType, storagePath: sp, size });
    };

    addMediaFile('screen', project.screenSource);
    addMediaFile('camera', project.cameraSource);
    addMediaFile('mic', project.microphoneSource);

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

    console.log(`[project-create-v2] Upserting project ${projectId} into workspace ${workspaceId}`);
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
    console.log(`[project-create-v2] Initiating multipart uploads for ${mediaFiles.length} files`);

    // 4. For each file: CreateMultipartUpload + presign N UploadPart URLs
    const uploads = await Promise.all(mediaFiles.map(async (mf) => {
        const create = await s3.send(new CreateMultipartUploadCommand({
            Bucket: BUCKET,
            Key: mf.storagePath,
            ContentType: CONTENT_TYPE_MAP[mf.fileType] ?? 'application/octet-stream',
        }));
        const uploadId = create.UploadId;
        if (!uploadId) throw new Error(`CreateMultipartUpload returned no UploadId for ${mf.storagePath}`);

        const partCount = Math.ceil(mf.size / PART_SIZE);
        const partUrls = await Promise.all(
            Array.from({ length: partCount }, (_, i) => getS3SignedUrl(
                s3,
                new UploadPartCommand({
                    Bucket: BUCKET,
                    Key: mf.storagePath,
                    UploadId: uploadId,
                    PartNumber: i + 1,
                }),
                { expiresIn: 3600 },
            )),
        );

        return { fileType: mf.fileType, storagePath: mf.storagePath, uploadId, partUrls };
    }));

    console.log(`[project-create-v2] Done, returning ${uploads.length} multipart upload handles`);
    return jsonResponse({
        projectId,
        bucket: BUCKET,
        partSize: PART_SIZE,
        uploads,
    });
}));
