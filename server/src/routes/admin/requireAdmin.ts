/**
 * preHandler factory for the /admin-* routes (user impersonation —
 * plans/admin-user-impersonation-oneshot.md): 403 unless the caller's
 * verified JWT email is in the ADMIN_EMAILS allowlist (compared
 * case-insensitively). Runs AFTER app.requireUser in the preHandler
 * array, so req.user is already set.
 *
 * Fail closed: no configured allowlist (tests, misconfigured deploy)
 * means nobody is admin.
 */
import type { preHandlerAsyncHookHandler } from 'fastify';

/** Shared options of the admin route plugins. */
export interface AdminRoutesOptions {
    /** Comma-separated ADMIN_EMAILS allowlist. */
    adminEmails?: string;
}

export function requireAdmin(adminEmails?: string): preHandlerAsyncHookHandler {
    const allowlist = new Set(
        (adminEmails ?? '')
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
    );
    return async (req, reply) => {
        const email = req.user?.email?.toLowerCase();
        if (!email || !allowlist.has(email)) {
            return reply.code(403).send({ error: 'Admin only' });
        }
    };
}
