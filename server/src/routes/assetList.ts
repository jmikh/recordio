/**
 * POST /asset-list — lists the caller's ready, not-deleted assets of one
 * type, newest first, each enriched with a presigned S3 GET downloadUrl
 * (Part 2 Batch 1, plans/fastify-part2-1-assets-rpc-migration.md).
 *
 * Ports the asset_list SQL function inline (the deployed fn stays frozen
 * until the Part 2 decommission sweep). The enrichment is the point:
 * ownership is established by the WHERE user_id filter right here, so the
 * client never round-trips storage paths through /storage-download-urls —
 * presigning is local HMAC, no network.
 *
 * Request:  { assetType: 'background' | 'music' }
 * Response: { assets: [{ id, assetType, storagePath, name, sizeBytes,
 *             createdAt, downloadUrl }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AssetListRequestSchema, AssetListResponseSchema } from '@shared/api/assets';

/** Same expiry as /storage-download-urls; late-miss refresh is client-side. */
const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

interface AssetRow {
    id: string;
    assetType: 'background' | 'music';
    storagePath: string;
    name: string | null;
    sizeBytes: number;
    createdAt: string;
}

export const assetListRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/asset-list',
        {
            preHandler: app.requireUser,
            schema: {
                body: AssetListRequestSchema,
                response: { 200: AssetListResponseSchema },
            },
        },
        async (req) => {
            // to_jsonb: a timestamptz would come back as a JS Date;
            // size_bytes::int: bigint comes back as a string
            const { rows } = await app.deps.db.query(
                `SELECT id,
                        asset_type          AS "assetType",
                        storage_path        AS "storagePath",
                        name,
                        size_bytes::int     AS "sizeBytes",
                        to_jsonb(created_at) AS "createdAt"
                 FROM user_assets
                 WHERE user_id = $1
                   AND asset_type = $2
                   AND status = 'ready'
                   AND is_deleted = false
                 ORDER BY created_at DESC`,
                [req.user!.id, req.body.assetType],
            );

            const assets = await Promise.all(
                (rows as AssetRow[]).map(async (row) => ({
                    ...row,
                    downloadUrl: await app.deps.s3.presignDownload(
                        row.storagePath,
                        DOWNLOAD_URL_EXPIRY_SECONDS,
                    ),
                })),
            );

            req.logCtx.set({
                'asset.type': req.body.assetType,
                'storage.path_count': assets.length,
            });
            return { assets };
        },
    );
};
