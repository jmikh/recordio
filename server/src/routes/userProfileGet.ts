/**
 * POST /user-profile-get — the caller's profile (Part 2 Batch 4).
 * Ports user_profile_get inline. Empty body; blob shape kept
 * (snake_case); null if no profile row (the signup trigger normally
 * guarantees one). No trial_ends_at since revamp Step 2 — the trial
 * lives on the workspace, delivered via entitlements.trialEndsAt.
 *
 * has_reviewed: whether the user has (claimed to have) left a CWS
 * review — gates the webapp's LeaveReviewModal; set by /user-review-set.
 *
 * Request:  {}
 * Response: { name, has_reviewed } | null
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

export const userProfileGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/user-profile-get',
        {
            preHandler: app.requireUser,
        },
        async (req, reply) => {
            const { rows } = await app.deps.db.query(
                `SELECT jsonb_build_object(
                    'name', p.name,
                    'has_reviewed', p.reviewed_at IS NOT NULL
                ) AS profile
                FROM user_profiles p
                WHERE p.user_id = $1`,
                [req.user!.id],
            );
            return reply.send((rows[0] as { profile: unknown } | undefined)?.profile ?? null);
        },
    );
};
