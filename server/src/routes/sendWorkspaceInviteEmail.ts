/**
 * POST /send-workspace-invite-email — ports the `send-workspace-invite`
 * edge fn (Wave E; the server route gains "email", user naming decision
 * 2026-07-23). Called by the `workspace_invite()` SQL RPC via pg_net.
 *
 * Auth: `requireServiceBearer(SUPABASE_SERVICE_ROLE_KEY)` in onRequest
 * (before schema validation) — the SQL fn sends `Bearer <Vault
 * SUPABASE_SECRET_KEY>`, same value (verified at cutover).
 *
 * INVITER-NAME FIX (documented divergence, user decision 2026-07-23):
 * the edge fn selects `user_profiles.display_name`, a column that
 * doesn't exist — the select silently errors and the inviter name has
 * always fallen back to the auth email. The server reads the real
 * `name` column: name → auth admin email → 'Someone'.
 *
 * Other divergence: per-field schema 400s replace the edge fn's single
 * `Missing fields` body (pg_net reads no bodies).
 *
 * A failed Resend send THROWS (500) — Railway logs are the surface.
 *
 * Response: { sent: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { requireServiceBearer } from '../plugins/auth.js';
import { sendWorkspaceInviteEmail } from '../services/workspaceInviteEmail.js';

export interface SendWorkspaceInviteEmailRoutesOptions {
    /** Bearer the DB's pg_net calls carry (SUPABASE_SERVICE_ROLE_KEY) */
    serviceBearerSecret?: string;
}

export const sendWorkspaceInviteEmailRoutes: FastifyPluginAsyncTypebox<
    SendWorkspaceInviteEmailRoutesOptions
> = async (app, opts) => {
    // Config is required at startup; the throw only fires in a test that
    // forgot to pass the secret (renderJobWebhook pattern)
    const auth = opts.serviceBearerSecret
        ? requireServiceBearer(opts.serviceBearerSecret)
        : async () => {
              throw new Error('sendWorkspaceInviteEmailRoutes: serviceBearerSecret not configured');
          };

    app.post(
        '/send-workspace-invite-email',
        {
            // Auth precedes body validation: bad body + bad secret must 401
            onRequest: auth,
            schema: {
                body: Type.Object({
                    workspace_id: Type.String({ minLength: 1 }),
                    email: Type.String({ minLength: 1 }),
                    role: Type.String({ minLength: 1 }),
                    token: Type.String({ minLength: 1 }),
                    invited_by: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({ sent: Type.Literal(true) }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    401: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req) => {
            const { workspace_id, email, role, token, invited_by } = req.body;
            req.logCtx.set({ 'workspace.id': workspace_id, 'email.template': 'workspace-invite' });

            // Shared with /workspace-invite (in-process caller) since the
            // Batch 3 port; throws on a failed send → 500 here
            await sendWorkspaceInviteEmail(app.deps, {
                workspaceId: workspace_id,
                email,
                role,
                token,
                invitedBy: invited_by,
            }, req.logCtx);

            return { sent: true as const };
        },
    );
};
