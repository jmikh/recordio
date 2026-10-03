/**
 * POST /admin-subscriber-list — the admin page's subscribers list
 * (plans/admin-user-impersonation-oneshot.md). Admin-only.
 *
 * Every subscriptions row (one per workspace that ever checked out),
 * joined to the buying user: Stripe status verbatim, billing interval
 * and seats (the single per-seat plan), a scheduled cancel_at, when
 * they first subscribed (the row's created_at — the webhook upsert
 * never touches it) and when the account was created. Newest
 * subscriber first. Small table, no cap.
 *
 * Request:  {}
 * Response: { subscribers: [{ workspace_id, workspace_name, user_id, email, name,
 *             status, billing_interval, seats, cancel_at, current_period_end,
 *             stripe_customer_id, subscribed_at, account_created_at }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

export const adminSubscriberListRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/admin-subscriber-list',
        {
            preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
        },
        async (_req, reply) => {
            const { rows } = await app.deps.db.query(
                `SELECT COALESCE(
                    jsonb_agg(jsonb_build_object(
                        'workspace_id',       s.workspace_id,
                        'workspace_name',     w.name,
                        'user_id',            s.user_id,
                        'email',              u.email,
                        'name',               p.name,
                        'status',             s.status,
                        'billing_interval',   s.billing_interval,
                        'seats',              s.seats,
                        'cancel_at',          s.cancel_at,
                        'current_period_end', s.current_period_end,
                        'stripe_customer_id', s.stripe_customer_id,
                        'subscribed_at',      s.created_at,
                        'account_created_at', u.created_at
                    ) ORDER BY s.created_at DESC NULLS LAST),
                    '[]'::jsonb
                 ) AS subscribers
                 FROM subscriptions s
                 JOIN workspaces w ON w.id = s.workspace_id
                 LEFT JOIN auth.users u ON u.id = s.user_id
                 LEFT JOIN user_profiles p ON p.user_id = s.user_id`,
            );
            return reply.send({ subscribers: (rows[0] as { subscribers: unknown }).subscribers });
        },
    );
};
