/**
 * POST /screenshot-confirm-upload — flips upload_status 'pending' →
 * 'ready' after the client finishes the TUS upload of the source PNG
 * (sibling of project-confirm-upload). Owner-only via the WHERE clause;
 * not-found / not-owned / already-ready are all `confirmed: false`.
 *
 * Request:  { screenshotId }
 * Response: { confirmed: boolean }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ScreenshotConfirmUploadResponseSchema, ScreenshotIdRequestSchema } from '@shared/api/screenshots';

export const screenshotConfirmUploadRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-confirm-upload',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotIdRequestSchema,
                response: { 200: ScreenshotConfirmUploadResponseSchema },
            },
        },
        async (req) => {
            const { screenshotId } = req.body;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            const { rowCount } = await app.deps.db.query(
                `UPDATE screenshots SET upload_status = 'ready'
                 WHERE id = $1 AND owner_id = $2 AND upload_status = 'pending'`,
                [screenshotId, req.user!.id],
            );
            return { confirmed: (rowCount ?? 0) > 0 };
        },
    );
};
