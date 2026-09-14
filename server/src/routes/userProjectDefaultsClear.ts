/**
 * POST /user-project-defaults-clear — removes the caller's personal
 * default project settings (plans/user-default-project-settings) so new
 * projects go back to the shipped factory defaults. Sets the column to
 * NULL rather than storing a snapshot of today's factory values, so
 * future factory changes reach the user. Idempotent — a user with
 * nothing stored (or no profile row) still gets 200.
 *
 * Request:  {}
 * Response: { cleared: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

export const userProjectDefaultsClearRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/user-project-defaults-clear',
        {
            preHandler: app.requireUser,
            schema: {
                response: {
                    200: Type.Object({ cleared: Type.Literal(true) }),
                },
            },
        },
        async (req) => {
            await app.deps.db.query(
                `UPDATE user_profiles
                 SET project_defaults = NULL, updated_at = now()
                 WHERE user_id = $1`,
                [req.user!.id],
            );
            return { cleared: true as const };
        },
    );
};
