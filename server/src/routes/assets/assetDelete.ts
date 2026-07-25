/**
 * POST /asset-delete — soft-deletes one of the caller's assets
 * (Part 2 Batch 1, plans/fastify-part2-1-assets-rpc-migration.md).
 *
 * Ports the asset_delete SQL function inline (the deployed fn stays
 * frozen until the Part 2 decommission sweep). Ownership is the UPDATE's
 * WHERE clause; not-found and not-owned are indistinguishable
 * (storagePath null) — SQL parity, kept.
 *
 * Request:  { assetId }
 * Response: { storagePath: string | null } — the path for cache eviction,
 *           null when nothing was deleted
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AssetDeleteRequestSchema, AssetDeleteResponseSchema } from '@shared/api/assets';

export const assetDeleteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/asset-delete',
        {
            preHandler: app.requireUser,
            schema: {
                body: AssetDeleteRequestSchema,
                response: { 200: AssetDeleteResponseSchema },
            },
        },
        async (req) => {
            const { rows } = await app.deps.db.query(
                `UPDATE user_assets
                 SET is_deleted = true
                 WHERE id = $1 AND user_id = $2
                 RETURNING storage_path AS "storagePath"`,
                [req.body.assetId, req.user!.id],
            );
            const storagePath = (rows[0] as { storagePath: string } | undefined)
                ?.storagePath ?? null;

            return { storagePath };
        },
    );
};
