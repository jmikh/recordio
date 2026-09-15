/**
 * POST /screenshot-delete — soft-deletes a screenshot (sibling of
 * project-delete). The owner check IS the UPDATE's WHERE clause —
 * non-owner, already-deleted, and missing are all `deleted: false`.
 *
 * Request:  { screenshotId }
 * Response: { deleted: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ScreenshotDeleteResponseSchema, ScreenshotIdRequestSchema } from '@shared/api/screenshots';

export const screenshotDeleteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-delete',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotIdRequestSchema,
                response: { 200: ScreenshotDeleteResponseSchema },
            },
        },
        async (req) => {
            const { screenshotId } = req.body;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            const { rowCount } = await app.deps.db.query(
                `UPDATE screenshots SET deleted_at = NOW()
                 WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
                [screenshotId, req.user!.id],
            );
            return { deleted: (rowCount ?? 0) > 0 };
        },
    );
};
