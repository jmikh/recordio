import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { S3Client, GetObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3';
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
 * Storage Download URLs Edge Function
 *
 * Returns presigned S3 URLs for files in project-media storage.
 * Uses S3-compatible endpoint for direct downloads (bypasses Supabase API proxy).
 * Verifies the caller owns all files by checking the storage path prefix.
 *
 * Request body: { storagePaths: string[] }
 * Response:     { signedUrls: Record<string, string> }
 */
serve(withAuth(async (req, { user }) => {
    const { storagePaths } = await req.json();

    if (!Array.isArray(storagePaths) || storagePaths.length === 0) {
        return errorResponse('Missing or empty storagePaths array', 400);
    }

    // Verify ownership: all storage paths must be prefixed with user_id (admin bypasses)
    const isAdmin = user.id === '01f290d7-6bfb-4076-8b09-097eca08fc8f';
    if (!isAdmin) {
        for (const path of storagePaths) {
            if (typeof path !== 'string' || !path.startsWith(`${user.id}/`)) {
                return errorResponse('Forbidden', 403);
            }
        }
    }

    const signedUrls: Record<string, string> = {};

    await Promise.all(
        storagePaths.map(async (storagePath: string) => {
            const command = new GetObjectCommand({ Bucket: BUCKET, Key: storagePath });
            signedUrls[storagePath] = await getSignedUrl(s3, command, { expiresIn: 3600 });
        }),
    );

    return jsonResponse({ signedUrls });
}));
