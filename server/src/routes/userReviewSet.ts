/**
 * POST /user-review-set — marks the caller as having left (or claimed
 * to have left) a Chrome Web Store review. Idempotent: the FIRST
 * timestamp wins; repeat calls are no-ops. The upsert covers the
 * no-profile-row edge (the signup trigger normally guarantees one).
 * The webapp's LeaveReviewModal stops showing once this is set.
 *
 * Request:  {}
 * Response: { hasReviewed: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

export const userReviewSetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/user-review-set',
        {
            preHandler: app.requireUser,
            schema: {
                response: {
                    200: Type.Object({ hasReviewed: Type.Literal(true) }),
                },
            },
        },
        async (req) => {
            await app.deps.db.query(
                `INSERT INTO user_profiles (user_id, reviewed_at)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id) DO UPDATE
                     SET reviewed_at = COALESCE(user_profiles.reviewed_at, EXCLUDED.reviewed_at)`,
                [req.user!.id, app.deps.clock.now()],
            );
            return { hasReviewed: true as const };
        },
    );
};
