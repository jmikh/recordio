import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';
const LIBRARY_LIMIT = 10; // per asset type per user

const VALID_TYPES = ['background', 'music'] as const;

/** Max file sizes per type */
const MAX_SIZE: Record<string, number> = {
    background: 25 * 1024 * 1024, // 25 MB
    music: 50 * 1024 * 1024,      // 50 MB
};

/** Allowed extensions per type */
const ALLOWED_EXT: Record<string, string[]> = {
    background: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    music: ['mp3', 'wav', 'aac', 'm4a', 'ogg'],
};

/**
 * Asset Create Edge Function
 *
 * Creates a pending user_assets row and returns a signed upload URL.
 * The client uploads directly to Supabase Storage, then calls the
 * confirm_asset_upload RPC to flip status to 'ready'.
 *
 * Request:  { assetType: 'background' | 'music', sizeBytes: number, fileName: string }
 * Response: { signedUrl, token, storagePath, assetId }
 */
serve(withAuth(async (req, { user, supabase }) => {
    const { assetType, sizeBytes, fileName } = await req.json();

    // 1. Validate inputs
    if (!assetType || !VALID_TYPES.includes(assetType)) {
        return errorResponse(`Invalid assetType. Must be one of: ${VALID_TYPES.join(', ')}`, 400);
    }
    if (!fileName || typeof fileName !== 'string') {
        return errorResponse('Missing fileName', 400);
    }
    if (!sizeBytes || typeof sizeBytes !== 'number' || sizeBytes <= 0) {
        return errorResponse('Invalid sizeBytes', 400);
    }

    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXT[assetType].includes(ext)) {
        return errorResponse(
            `Invalid file type ".${ext}" for ${assetType}. Allowed: ${ALLOWED_EXT[assetType].join(', ')}`,
            400,
        );
    }

    if (sizeBytes > MAX_SIZE[assetType]) {
        const maxMB = MAX_SIZE[assetType] / (1024 * 1024);
        return errorResponse(`File too large. Max ${maxMB} MB for ${assetType}`, 400);
    }

    // 2. Check library limit
    const { count, error: countError } = await supabase
        .from('user_assets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('asset_type', assetType)
        .eq('status', 'ready')
        .eq('is_deleted', false);

    if (countError) {
        console.error('[asset-create] Count query failed:', countError);
        return errorResponse('Failed to check library size', 500);
    }

    if ((count ?? 0) >= LIBRARY_LIMIT) {
        return jsonResponse({
            error: 'library_full',
            message: `Library full (${LIBRARY_LIMIT}/${LIBRARY_LIMIT}). Delete an asset to upload a new one.`,
            count: count ?? 0,
            limit: LIBRARY_LIMIT,
        }, 403);
    }

    // 3. Create asset ID and storage path
    const assetId = crypto.randomUUID();
    const storagePath = `${user.id}/assets/${assetId}.${ext}`;

    // 4. Insert pending row
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { error: insertError } = await adminSupabase
        .from('user_assets')
        .insert({
            id: assetId,
            user_id: user.id,
            asset_type: assetType,
            storage_path: storagePath,
            name: fileName,
            size_bytes: sizeBytes,
            status: 'pending',
        });

    if (insertError) {
        console.error('[asset-create] Insert failed:', insertError);
        return errorResponse('Failed to create asset record', 500);
    }

    // 5. Create signed upload URL
    const { data: signedData, error: signError } = await adminSupabase
        .storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: true });

    if (signError || !signedData) {
        console.error('[asset-create] Signed URL creation failed:', signError);
        // Clean up the pending row
        await adminSupabase.from('user_assets').delete().eq('id', assetId);
        return errorResponse('Failed to create upload URL', 500);
    }

    return jsonResponse({
        signedUrl: signedData.signedUrl,
        token: signedData.token,
        storagePath,
        assetId,
    });
}));
