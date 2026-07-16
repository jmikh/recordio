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
import { storageDownloadUrlsRoutes } from './routes/storageDownloadUrls.js';
import { sharedVideoGetRoutes } from './routes/sharedVideoGet.js';

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
