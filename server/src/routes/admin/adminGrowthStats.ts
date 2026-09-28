/**
 * POST /admin-growth-stats — the admin growth dashboard's data. Admin-only.
 *
 * Signups (auth.users) and project creations counted per UTC day, from
 * the first row of each to the latest, ascending. Sparse: days with
 * nothing created are omitted. Two GROUP BYs over created_at — small
 * enough (one row per active day) that the page takes the whole
 * history in one fetch and re-buckets (day/week/month) and switches
 * rate/cumulative without coming back.
 *
 * Projects count every row ever created, permanently-deleted ones
 * included — this measures creation, not what still exists.
 *
 * Request:  {}
 * Response: { accounts: [{ day, count }], projects: [{ day, count }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { AdminDailyCount } from '@shared/api';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

export const adminGrowthStatsRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/admin-growth-stats',
        {
            preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
        },
        async (_req, reply) => {
            // to_char rather than a bare ::date so pg hands back the
            // YYYY-MM-DD string instead of a timezone-shifted JS Date
            const dailyCounts = async (table: string): Promise<AdminDailyCount[]> => {
                const { rows } = await app.deps.db.query(
                    `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
                            count(*)::int AS count
                     FROM ${table}
                     GROUP BY 1
                     ORDER BY 1`,
                );
                return rows as AdminDailyCount[];
            };

            const [accounts, projects] = await Promise.all([
                dailyCounts('auth.users'),
                dailyCounts('projects'),
            ]);
            return reply.send({ accounts, projects });
        },
    );
};
