import Fastify, { LogController } from 'fastify';
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import type { DestinationStream } from 'pino';
import type { Deps } from './deps.js';
import { createLogger, RequestLogContext } from './logging.js';
import { authPlugin } from './plugins/auth.js';
import { storageDownloadUrlsRoutes } from './routes/assets/storageDownloadUrls.js';
import { sharedVideoGetRoutes } from './routes/sharedVideoGet.js';
import { stripeCheckoutRoutes, type StripePriceIds } from './routes/billing/stripeCheckout.js';
import { stripePortalRoutes } from './routes/billing/stripePortal.js';
import { subscriptionChangeRoutes } from './routes/billing/subscriptionChange.js';
import { projectUpdateThumbnailRoutes } from './routes/projects/projectUpdateThumbnail.js';
import { assetUploadRoutes } from './routes/assets/assetUpload.js';
import { projectCreateV2Routes } from './routes/projects/projectCreateV2.js';
import { renderJobCreateRoutes } from './routes/renderJobCreate.js';
import { muxVideoCreateRoutes } from './routes/muxVideoCreate.js';
import { renderJobWebhookRoutes } from './routes/renderJobWebhook.js';
import { muxVideoWebhookRoutes } from './routes/muxVideoWebhook.js';
import { stripeWebhooksRoutes } from './routes/billing/stripeWebhooks.js';
import { sendWorkspaceInviteEmailRoutes } from './routes/sendWorkspaceInviteEmail.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { assetListRoutes } from './routes/assets/assetList.js';
import { assetDeleteRoutes } from './routes/assets/assetDelete.js';
import { projectGetRoutes } from './routes/projects/projectGet.js';
import { projectListRoutes } from './routes/projects/projectList.js';
import { projectUpdateRoutes } from './routes/projects/projectUpdate.js';
import { projectUpdateNameRoutes } from './routes/projects/projectUpdateName.js';
import { projectRenameRoutes } from './routes/projects/projectRename.js';
import { projectShareRoutes } from './routes/projects/projectShare.js';
import { projectDeleteRoutes } from './routes/projects/projectDelete.js';
import { projectRestoreRoutes } from './routes/projects/projectRestore.js';
import { projectConfirmUploadRoutes } from './routes/projects/projectConfirmUpload.js';
import { renderJobGetStatusRoutes } from './routes/renderJobGetStatus.js';
import { workspaceGetRoutes } from './routes/workspaces/workspaceGet.js';
import { workspaceListRoutes } from './routes/workspaces/workspaceList.js';
import { workspaceRenameRoutes } from './routes/workspaces/workspaceRename.js';
import { workspaceSetDefaultRoutes } from './routes/workspaces/workspaceSetDefault.js';
import { workspaceInviteRoutes } from './routes/workspaces/workspaceInvite.js';
import { workspaceInviteAcceptRoutes } from './routes/workspaces/workspaceInviteAccept.js';
import { workspaceInviteRescindRoutes } from './routes/workspaces/workspaceInviteRescind.js';
import { workspaceMemberRemoveRoutes } from './routes/workspaces/workspaceMemberRemove.js';
import { workspaceMemberUpdateRoleRoutes } from './routes/workspaces/workspaceMemberUpdateRole.js';
import { userProfileGetRoutes } from './routes/userProfileGet.js';
import { userReviewSetRoutes } from './routes/userReviewSet.js';
import { workspaceGetDefaultRoutes } from './routes/workspaces/workspaceGetDefault.js';
import { subscriptionGetRoutes } from './routes/billing/subscriptionGet.js';
import { trialExtendRoutes } from './routes/billing/trialExtend.js';

declare module 'fastify' {
    interface FastifyInstance {
        deps: Deps;
    }
    interface FastifyRequest {
        logCtx: RequestLogContext;
        /** Set by the auth plugin (Step 1); folded into the canonical log event. */
        userId?: string;
    }
}

export interface AppOptions {
    /** Git SHA of the running deploy, surfaced by /health and the log envelope. */
    version?: string;
    env?: string;
    /** Legacy HS256 secret Supabase signs user JWTs with */
    supabaseJwtSecret?: string;
    /** Supabase project URL — enables ES256/RS256 user tokens via its JWKS */
    supabaseUrl?: string;
    logLevel?: string;
    /** Injectable for tests — assert emitted log events */
    logStream?: DestinationStream;
    prettyLogs?: boolean;
    /** Ship logs to Axiom (in addition to stdout) — set by server.ts from env */
    axiom?: { dataset: string; token: string };
    /** Stripe price ids by `${plan}_${interval}` — required by /stripe-checkout */
    stripePriceIds?: StripePriceIds;
    /** This server's own public base URL — statusCallbackUrl = `${publicUrl}/render-job-webhook` */
    publicUrl?: string;
    /** Shared bearer secret the render worker authenticates with (RENDER_SECRET) */
    renderSecret?: string;
    /** Bearer the DB's pg_net email calls carry (SUPABASE_SERVICE_ROLE_KEY) */
    serviceRoleKey?: string;
}

export type App = ReturnType<typeof buildApp>;

/**
 * App factory — no top-level side effects, every external dependency
 * injected. `server.ts` builds real deps from env; tests call
 * `buildApp(fakeDeps)` and drive it with `app.inject()`.
 */
export function buildApp(deps: Deps, opts: AppOptions = {}) {
    const version = opts.version ?? 'dev';
    const env = opts.env ?? 'development';

    const app = Fastify({
        loggerInstance: createLogger({
            env,
            version,
            level: opts.logLevel,
            stream: opts.logStream,
            pretty: opts.prettyLogs,
            axiom: opts.axiom,
        }),
        // One canonical event per request (onResponse below) instead of
        // fastify's incoming/completed pair
        logController: new LogController({
            disableRequestLogging: true,
            requestIdLogLabel: 'request_id',
        }),
        genReqId: () => randomUUID(),
    }).withTypeProvider<TypeBoxTypeProvider>();

    app.decorate('deps', deps);
    app.decorateRequest('logCtx', null as unknown as RequestLogContext);

    app.addHook('onRequest', async (req) => {
        req.logCtx = new RequestLogContext();
    });

    // The canonical request event — handlers contribute via req.logCtx
    app.addHook('onResponse', async (req, reply) => {
        req.log.info({
            'http.route': req.routeOptions.url ?? 'unmatched',
            'http.request.method': req.method,
            'http.response.status_code': reply.statusCode,
            duration_ms: Math.round(reply.elapsedTime * 10) / 10,
            user_id: req.userId,
            ...req.logCtx.fields,
        }, 'request');
    });

    if (opts.supabaseJwtSecret || opts.supabaseUrl) {
        app.register(authPlugin, {
            supabaseJwtSecret: opts.supabaseJwtSecret,
            supabaseUrl: opts.supabaseUrl,
        });
    } else {
        // Fail closed, loudly: a protected route without a configured secret
        // is a deployment error, not an open door
        app.decorate('requireUser', async () => {
            throw new Error('Neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured');
        });
    }

    // Matches the edge functions' CORS surface (_shared/auth.ts)
    app.register(cors, {
        origin: '*',
        allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
    });

    // Global backstop; public routes get stricter per-route limits
    app.register(rateLimit, {
        max: 300,
        timeWindow: '1 minute',
    });

    // Migrated edge-function routes (plan Step 4) — one module per function
    app.register(storageDownloadUrlsRoutes);
    app.register(sharedVideoGetRoutes);
    app.register(stripeCheckoutRoutes, { priceIds: opts.stripePriceIds });
    app.register(stripePortalRoutes);
    app.register(subscriptionChangeRoutes, { priceIds: opts.stripePriceIds });
    app.register(projectUpdateThumbnailRoutes);
    app.register(assetUploadRoutes);
    app.register(projectCreateV2Routes);
    app.register(transcribeRoutes);
    // Wave D cutover: newly dispatched jobs call THIS server's webhook.
    // In-flight jobs keep whatever URL they were dispatched with (the
    // still-live edge hook) — the URL is per-job payload, so overlap is
    // automatic and safe until decommission.
    const statusCallbackUrl = opts.publicUrl
        ? `${opts.publicUrl}/render-job-webhook`
        : undefined;
    app.register(renderJobCreateRoutes, { statusCallbackUrl });
    app.register(muxVideoCreateRoutes, { statusCallbackUrl });
    app.register(renderJobWebhookRoutes, { renderSecret: opts.renderSecret });
    app.register(muxVideoWebhookRoutes);
    app.register(stripeWebhooksRoutes);
    app.register(sendWorkspaceInviteEmailRoutes, { serviceBearerSecret: opts.serviceRoleKey });

    // Part 2 routes — client RPCs ported inline, batch by batch
    // (plans/fastify-part2-rpc-proxy-migration.md)
    app.register(assetListRoutes);
    app.register(assetDeleteRoutes);
    app.register(projectGetRoutes);
    app.register(projectListRoutes);
    app.register(projectUpdateRoutes);
    app.register(projectUpdateNameRoutes);
    app.register(projectRenameRoutes);
    app.register(projectShareRoutes);
    app.register(projectDeleteRoutes);
    app.register(projectRestoreRoutes);
    app.register(projectConfirmUploadRoutes);
    app.register(renderJobGetStatusRoutes);
    app.register(workspaceGetRoutes);
    app.register(workspaceListRoutes);
    app.register(workspaceRenameRoutes);
    app.register(workspaceSetDefaultRoutes);
    app.register(workspaceInviteRoutes);
    app.register(workspaceInviteAcceptRoutes);
    app.register(workspaceInviteRescindRoutes);
    app.register(workspaceMemberRemoveRoutes);
    app.register(workspaceMemberUpdateRoleRoutes);
    app.register(userProfileGetRoutes);
    app.register(userReviewSetRoutes);
    app.register(workspaceGetDefaultRoutes);
    app.register(subscriptionGetRoutes);

    // Billing revamp Step 3 — self-serve trial extension
    app.register(trialExtendRoutes);

    app.get('/health', {
        schema: {
            response: {
                200: Type.Object({
                    status: Type.Literal('ok'),
                    version: Type.String(),
                }),
            },
        },
    }, async () => ({ status: 'ok' as const, version }));

    // Throws on purpose — verifies errors reach Sentry (see server/README.md)
    app.get('/debug-sentry', async () => {
        throw new Error('debug-sentry test error');
    });

    return app;
}
