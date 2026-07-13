import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Type } from '@sinclair/typebox';
import type { Deps } from './deps.js';

declare module 'fastify' {
    interface FastifyInstance {
        deps: Deps;
    }
}

export interface AppOptions {
    logger?: FastifyServerOptions['logger'];
    /** Git SHA of the running deploy, surfaced by /health. */
    version?: string;
}

/**
 * App factory — no top-level side effects, every external dependency
 * injected. `server.ts` builds real deps from env; tests call
 * `buildApp(fakeDeps)` and drive it with `app.inject()`.
 */
export function buildApp(deps: Deps, opts: AppOptions = {}): FastifyInstance {
    const app = Fastify({
        logger: opts.logger ?? false,
    }).withTypeProvider<TypeBoxTypeProvider>();

    app.decorate('deps', deps);

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

    const version = opts.version ?? 'dev';

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
