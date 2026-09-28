/**
 * POST /admin-status — the /admin page's "am I admin" probe. Admin-only.
 *
 * Does nothing but pass the requireAdmin gate: 200 `{ ok: true }` for
 * allowlisted admins, 403 for everyone else. The page renders nothing
 * until this answers and turns the 403 into a plain 404, so neither
 * the impersonation picker nor the growth dashboard ever loads (or
 * fetches) for a non-admin.
 *
 * Request:  {}
 * Response: { ok: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

export const adminStatusRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/admin-status',
        {
            preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
        },
        async (_req, reply) => reply.send({ ok: true }),
    );
};
