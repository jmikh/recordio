import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, CompleteMultipartUploadCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
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

/**
 * Finalize one or more S3 multipart uploads for a project, then flip the
 * project's upload_status from 'pending' to 'ready'.
 *
 * The AWS SDK signs requests with the Authorization header automatically
 * (server-side creds), which is required by Supabase's S3 protocol for
 * CompleteMultipartUpload. The client can't do this directly because
 * query-string-signed presigned URLs don't satisfy the storage-api's
 * Authorization-header validation on that route.
 *
 * Request:
 *   {
 *     projectId: string,
 *     completions: [{
 *       storagePath: string,
 *       uploadId: string,
 *       parts: [{ partNumber: number, etag: string }]
 *     }]
 *   }
 *
 * Response: { ok: true }
 */
serve(withAuth('project-multipart-complete', async (req, { user }) => {
    const { projectId, completions } = await req.json() as {
        projectId?: string;
        completions?: { storagePath: string; uploadId: string; parts: { partNumber: number; etag: string }[] }[];
    };

    if (!projectId) return errorResponse('Missing projectId', 400);
    if (!Array.isArray(completions) || completions.length === 0) {
        return errorResponse('Missing or empty completions', 400);
    }

    // Defense-in-depth: ensure each storagePath starts with the caller's user id.
    // The presigned upload URLs from project-create-v2 already constrained the keys,
    // but the client is naming them here so re-validate.
    for (const c of completions) {
        if (!c.storagePath.startsWith(`${user.id}/`)) {
            return errorResponse(`storagePath does not belong to caller: ${c.storagePath}`, 403);
        }
        if (!c.uploadId) return errorResponse('Missing uploadId on a completion', 400);
        if (!Array.isArray(c.parts) || c.parts.length === 0) {
            return errorResponse(`Missing parts for ${c.storagePath}`, 400);
        }
    }

    console.log(`[project-multipart-complete] Finalizing ${completions.length} uploads for project ${projectId}`);

    await Promise.all(completions.map(async (c) => {
        const sortedParts = [...c.parts].sort((a, b) => a.partNumber - b.partNumber);
        await s3.send(new CompleteMultipartUploadCommand({
            Bucket: BUCKET,
            Key: c.storagePath,
            UploadId: c.uploadId,
            MultipartUpload: {
                Parts: sortedParts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })),
            },
        }));
    }));

    // Flip upload_status from 'pending' to 'ready' via the existing RPC.
    // Use a user-scoped client so the function's auth.uid() check matches.
    const userSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: confirmed, error: confirmError } = await userSupabase.rpc('project_confirm_upload', {
        p_project_id: projectId,
    });
    if (confirmError) throw new Error('project_confirm_upload failed', { cause: confirmError });
    if (!confirmed) {
        console.warn(`[project-multipart-complete] project_confirm_upload returned false for ${projectId}`);
    }

    return jsonResponse({ ok: true });
}));
