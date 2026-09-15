/**
 * POST /screenshot-rename — renames a screenshot (sibling of
 * project-rename). Editor access.
 *
 * Request:  { screenshotId, name }
 * Response: { ok: true } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ScreenshotRenameRequestSchema, ScreenshotRenameResponseSchema } from '@shared/api/screenshots';
import { canEditScreenshot } from '../../services/screenshotAccess.js';

export const screenshotRenameRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-rename',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotRenameRequestSchema,
                response: {
                    200: ScreenshotRenameResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { screenshotId, name } = req.body;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            if (!await canEditScreenshot(app.deps.db, screenshotId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this screenshot' });
            }

            await app.deps.db.query(
                `UPDATE screenshots SET name = $2, updated_at = NOW()
                 WHERE id = $1 AND deleted_at IS NULL`,
                [screenshotId, name],
            );
            return { ok: true as const };
        },
    );
};
