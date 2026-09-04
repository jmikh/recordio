/**
 * POST /admin-user-list — the impersonation picker's user list
 * (plans/admin-user-impersonation-oneshot.md). Admin-only.
 *
 * Users sorted most-recently-active first: GREATEST(last sign-in,
 * latest owned-project update). Capped at 500 rows — the /admin page
 * fuzzy-filters client-side, so one fetch serves the whole session.
 * The 403 doubles as the page's "am I admin" probe.
 *
 * Request:  {}
 * Response: { users: [{ id, email, name, created_at, last_active_at, project_count }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

export const adminUserListRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/admin-user-list',
        {
            preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
        },
        async (req, reply) => {
            const { rows } = await app.deps.db.query(
                `SELECT COALESCE(
                    jsonb_agg(r.obj ORDER BY r.last_active_at DESC NULLS LAST, r.created_at DESC),
                    '[]'::jsonb
                ) AS users
                FROM (
                    SELECT jsonb_build_object(
                        'id', u.id,
                        'email', u.email,
                        'name', p.name,
                        'created_at', u.created_at,
                        'last_active_at', GREATEST(u.last_sign_in_at, pr.last_project_at),
                        'project_count', COALESCE(pr.project_count, 0)
                    ) AS obj,
                    GREATEST(u.last_sign_in_at, pr.last_project_at) AS last_active_at,
                    u.created_at
                    FROM auth.users u
                    LEFT JOIN user_profiles p ON p.user_id = u.id
                    LEFT JOIN (
                        SELECT owner_id,
                               count(*)::int AS project_count,
                               max(updated_at) AS last_project_at
                        FROM projects
                        WHERE permanently_deleted = false
                        GROUP BY owner_id
                    ) pr ON pr.owner_id = u.id
                    ORDER BY GREATEST(u.last_sign_in_at, pr.last_project_at) DESC NULLS LAST,
                             u.created_at DESC
                    LIMIT 500
                ) r`,
            );
            return reply.send({ users: (rows[0] as { users: unknown }).users });
        },
    );
};
