/**
 * POST /screenshot-restore — restores a soft-deleted screenshot
 * (sibling of project-restore). Owner-only via the WHERE clause;
 * permanently-deleted screenshots cannot be restored. Restore is
 * trial/Pro: the workspace must have canRestore, else 403
 * subscription_required. Unknown/non-owned ids return
 * { restored: false } — indistinguishable from a no-op.
 *
 * Request:  { screenshotId }
 * Response: { restored: boolean } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ScreenshotIdRequestSchema, ScreenshotRestoreResponseSchema } from '@shared/api/screenshots';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const screenshotRestoreRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-restore',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotIdRequestSchema,
                response: {
                    200: ScreenshotRestoreResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { screenshotId } = req.body;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            const { rows } = await app.deps.db.query(
                `SELECT workspace_id AS "workspaceId" FROM screenshots
                 WHERE id = $1 AND owner_id = $2`,
                [screenshotId, req.user!.id],
            );
            const workspaceId = (rows[0] as { workspaceId: string } | undefined)?.workspaceId;
            if (workspaceId) {
                const entitlements = await getWorkspaceEntitlements(
                    app.deps.db,
                    app.deps.clock,
                    workspaceId,
                );
                if (!entitlements.canRestore) {
                    return reply.code(403).send({ error: 'subscription_required' });
                }
            }

            const { rowCount } = await app.deps.db.query(
                `UPDATE screenshots SET deleted_at = NULL
                 WHERE id = $1 AND owner_id = $2
                   AND deleted_at IS NOT NULL
                   AND permanently_deleted = false`,
                [screenshotId, req.user!.id],
            );
            return { restored: (rowCount ?? 0) > 0 };
        },
    );
};
