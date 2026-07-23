/**
 * POST /send-welcome-email — ports the `send-welcome-email` edge fn
 * (Wave E). Called by the client-invoked `trial_start()` SQL RPC via
 * pg_net (NOT an auth.users trigger — the plan's Wave E text was
 * stale), body `{ record: { id, email } }` (a leftover DB-webhook
 * shape, kept for parity). Idempotency lives in trial_start itself
 * (`trial_ends_at` one-shot guard) — no flag here.
 *
 * Auth: `requireServiceBearer(SUPABASE_SERVICE_ROLE_KEY)` in onRequest
 * (before schema validation) — the SQL fn sends `Bearer <Vault
 * SUPABASE_SECRET_KEY>`, same value (verified at cutover).
 *
 * Divergences (documented): missing `record` → Fastify's schema 400
 * (edge fn: `{ error: 'No record' }`; pg_net reads no bodies). The
 * edge fn's `email_subscribed` skip-check and unsubscribe-JWT link are
 * GONE — the unsubscribe feature was removed (user decision
 * 2026-07-23).
 *
 * A failed Resend send THROWS (500): pg_net ignores responses, so the
 * Railway log/Sentry trail is the only failure surface.
 *
 * Response: { sent: true } | { skipped: true, reason }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { requireServiceBearer } from '../plugins/auth.js';
import { buildWelcomeEmailHtml, WELCOME_EMAIL_SUBJECT } from '../emails/welcomeEmail.js';

export interface SendWelcomeEmailRoutesOptions {
    /** Bearer the DB's pg_net calls carry (SUPABASE_SERVICE_ROLE_KEY) */
    serviceBearerSecret?: string;
}

export const sendWelcomeEmailRoutes: FastifyPluginAsyncTypebox<SendWelcomeEmailRoutesOptions> = async (
    app,
    opts,
) => {
    // Config is required at startup; the throw only fires in a test that
    // forgot to pass the secret (renderJobWebhook pattern)
    const auth = opts.serviceBearerSecret
        ? requireServiceBearer(opts.serviceBearerSecret)
        : async () => {
              throw new Error('sendWelcomeEmailRoutes: serviceBearerSecret not configured');
          };

    app.post(
        '/send-welcome-email',
        {
            // Auth precedes body validation: bad body + bad secret must 401
            onRequest: auth,
            schema: {
                body: Type.Object({
                    record: Type.Object({
                        id: Type.String({ minLength: 1 }),
                        email: Type.Optional(Type.String()),
                    }),
                }),
                response: {
                    200: Type.Union([
                        Type.Object({ sent: Type.Literal(true) }),
                        Type.Object({ skipped: Type.Literal(true), reason: Type.String() }),
                    ]),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    401: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req) => {
            const { id: userId, email } = req.body.record;
            req.logCtx.set({ 'email.template': 'welcome' });

            if (!email) {
                req.log.warn({ user_id: userId }, 'welcome email skipped: no email on record');
                return { skipped: true as const, reason: 'no email' };
            }

            const result = await app.deps.email.send({
                to: email,
                subject: WELCOME_EMAIL_SUBJECT,
                html: buildWelcomeEmailHtml(),
            });
            if (!result.success) {
                throw new Error(`Resend send failed: ${result.error}`);
            }

            return { sent: true as const };
        },
    );
};
