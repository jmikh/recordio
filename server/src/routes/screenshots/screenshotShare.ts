/**
 * POST /screenshot-share — updates a screenshot's share policy +
 * workspace access level (sibling of project-share, minus the
 * per-user-grant override rule: screenshots have no grants in v1).
 * OWNER-only. Slugs are permanent (DB default at insert).
 *
 * Share links are trial/Pro: the workspace's entitlements must have
 * canShare — EXCEPT for sharePolicy 'private', which is always allowed
 * (an expired-trial owner must be able to un-share).
 *
 * Request:  { screenshotId, sharePolicy, workspaceAccess? }
 * Response: { slug } | 404 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ScreenshotShareRequestSchema, ScreenshotShareResponseSchema } from '@shared/api/screenshots';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const screenshotShareRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-share',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotShareRequestSchema,
                response: {
                    200: ScreenshotShareResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { screenshotId, sharePolicy, workspaceAccess } = req.body;
            const db = app.deps.db;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            const { rows } = await db.query(
                `SELECT slug, owner_id AS "ownerId", workspace_id AS "workspaceId"
                 FROM screenshots
                 WHERE id = $1 AND deleted_at IS NULL`,
                [screenshotId],
            );
            const screenshot = rows[0] as
                | { slug: string; ownerId: string; workspaceId: string }
                | undefined;

            if (!screenshot) {
                return reply.code(404).send({ error: 'Screenshot not found' });
            }
            if (screenshot.ownerId !== req.user!.id) {
                return reply.code(403).send({ error: 'Only the screenshot owner can share a screenshot' });
            }

            if (sharePolicy !== 'private') {
                const entitlements = await getWorkspaceEntitlements(
                    db,
                    app.deps.clock,
                    screenshot.workspaceId,
                );
                if (!entitlements.canShare) {
                    return reply.code(403).send({ error: 'subscription_required' });
                }
            }

            await db.query(
                `UPDATE screenshots
                 SET share_policy = $2,
                     workspace_access = COALESCE($3, workspace_access),
                     updated_at = NOW()
                 WHERE id = $1`,
                [screenshotId, sharePolicy, workspaceAccess ?? null],
            );

            req.logCtx.set({ 'screenshot.slug': screenshot.slug, 'share.policy': sharePolicy });
            return { slug: screenshot.slug };
        },
    );
};
