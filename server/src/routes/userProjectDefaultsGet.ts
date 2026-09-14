/**
 * POST /user-project-defaults-get — the caller's personal default
 * project settings (plans/user-default-project-settings). Empty body.
 * Returns the stored { schemaVersion, settings } blob verbatim, or null
 * when the user never saved defaults (no profile row, or a NULL
 * column) — the webapp then falls back to the shipped factory defaults.
 * No response schema on purpose: the blob is arbitrary jsonb and the
 * serializer would strip fields (project-get precedent).
 *
 * Request:  {}
 * Response: StoredProjectDefaults | null
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';

export const userProjectDefaultsGetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/user-project-defaults-get',
        {
            preHandler: app.requireUser,
        },
        async (req, reply) => {
            const { rows } = await app.deps.db.query(
                `SELECT project_defaults FROM user_profiles WHERE user_id = $1`,
                [req.user!.id],
            );
            const row = rows[0] as { project_defaults: unknown } | undefined;
            return reply.send(row?.project_defaults ?? null);
        },
    );
};
