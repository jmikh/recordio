/**
 * POST /admin-impersonate — mints an impersonation JWT for a target
 * user (plans/admin-user-impersonation-oneshot.md). Admin-only.
 *
 * The token is a normal HS256 user JWT (sub = target,
 * role = 'authenticated') signed with SUPABASE_JWT_SECRET, so every
 * existing route accepts it unchanged — plus an `impersonated_by`
 * claim the auth plugin surfaces for per-request audit logging. 1h
 * expiry, no refresh; the webapp keeps it in sessionStorage only.
 * Full read-write by design — the banner and audit trail are the
 * guardrails, not write blocking.
 *
 * Request:  { userId }
 * Response: { token, expiresAt, targetUser: { id, email, name } }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SignJWT } from 'jose';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

const IMPERSONATION_TTL_SECONDS = 60 * 60;

export interface AdminImpersonateRoutesOptions extends AdminRoutesOptions {
    /** Legacy HS256 secret the minted token is signed with (SUPABASE_JWT_SECRET). */
    supabaseJwtSecret?: string;
}

export const adminImpersonateRoutes: FastifyPluginAsyncTypebox<AdminImpersonateRoutesOptions> =
    async (app, opts) => {
        app.post(
            '/admin-impersonate',
            {
                preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
                schema: {
                    body: Type.Object({
                        userId: Type.String({ minLength: 1 }),
                    }),
                },
            },
            async (req, reply) => {
                if (!opts.supabaseJwtSecret) {
                    // HS256 minting is the whole feature — without the legacy
                    // secret (JWKS-only config) it cannot work
                    return reply.code(500).send({ error: 'SUPABASE_JWT_SECRET not configured' });
                }

                // ::text comparison so a malformed id is a 404, not a uuid cast error
                const { rows } = await app.deps.db.query(
                    `SELECT u.id, u.email, p.name
                     FROM auth.users u
                     LEFT JOIN user_profiles p ON p.user_id = u.id
                     WHERE u.id::text = $1`,
                    [req.body.userId],
                );
                const target = rows[0] as
                    | { id: string; email: string | null; name: string | null }
                    | undefined;
                if (!target) return reply.code(404).send({ error: 'User not found' });

                const nowSeconds = Math.floor(app.deps.clock.now().getTime() / 1000);
                const expiresAtSeconds = nowSeconds + IMPERSONATION_TTL_SECONDS;
                const token = await new SignJWT({
                    email: target.email ?? undefined,
                    user_metadata: target.name ? { full_name: target.name } : {},
                    role: 'authenticated',
                    impersonated_by: req.user!.id,
                })
                    .setProtectedHeader({ alg: 'HS256' })
                    .setSubject(target.id)
                    .setAudience('authenticated')
                    .setIssuedAt(nowSeconds)
                    .setExpirationTime(expiresAtSeconds)
                    .sign(new TextEncoder().encode(opts.supabaseJwtSecret));

                req.logCtx.set({ 'admin.target_user_id': target.id });
                req.log.info(
                    {
                        admin_id: req.user!.id,
                        admin_email: req.user!.email,
                        target_id: target.id,
                        target_email: target.email,
                    },
                    'admin impersonation token minted',
                );

                return reply.send({
                    token,
                    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
                    targetUser: target,
                });
            },
        );
    };
