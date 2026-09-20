/**
 * preHandler factories for the admin surface (user impersonation —
 * plans/admin-user-impersonation-oneshot.md).
 *
 * requireAdmin gates the /admin-* routes: 403 unless the caller's
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
    const allowlist = parseAllowlist(adminEmails);
    return async (req, reply) => {
        const email = req.user?.email?.toLowerCase();
        if (!email || !allowlist.has(email)) {
            return reply.code(403).send({ error: 'Admin only' });
        }
    };
}

/**
 * The gate for routes an admin may only reach FROM INSIDE an
 * impersonation session (/project-clone). The bearer is the target
 * user's minted token, so `req.user` is the target — the admin is only
 * named by the token's `impersonated_by` claim, and that id's email has
 * to be on the same ADMIN_EMAILS allowlist (the claim is signed, but
 * an admin removed from the allowlist must lose the route with their
 * still-live 1h token).
 *
 * Fails closed exactly like requireAdmin: a plain session token (no
 * claim) is a 403, and so is an unconfigured allowlist.
 */
export function requireImpersonatingAdmin(adminEmails?: string): preHandlerAsyncHookHandler {
    const allowlist = parseAllowlist(adminEmails);
    return async (req, reply) => {
        const adminId = req.user?.impersonatedBy;
        if (!adminId || allowlist.size === 0) {
            return reply.code(403).send({ error: 'Admin impersonation only' });
        }
        const { rows } = await req.server.deps.db.query(
            'SELECT email FROM auth.users WHERE id::text = $1',
            [adminId],
        );
        const email = (rows[0] as { email: string | null } | undefined)?.email?.toLowerCase();
        if (!email || !allowlist.has(email)) {
            return reply.code(403).send({ error: 'Admin impersonation only' });
        }
    };
}

function parseAllowlist(adminEmails?: string): Set<string> {
    return new Set(
        (adminEmails ?? '')
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
    );
}
