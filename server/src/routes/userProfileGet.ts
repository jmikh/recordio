/**
 * POST /user-profile-get — the caller's profile (name, trial status)
 * (Part 2 Batch 4). Ports user_profile_get inline. Empty body; blob
 * shape kept (snake_case); null if no profile row (the signup trigger
 * normally guarantees one).
 *
 * Request:  {}
 * Response: { name, trial_ends_at } | null
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
                    'name',          p.name,
                    'trial_ends_at', p.trial_ends_at
                ) AS profile
                FROM user_profiles p
                WHERE p.user_id = $1`,
                [req.user!.id],
            );
            return reply.send((rows[0] as { profile: unknown } | undefined)?.profile ?? null);
        },
    );
};
