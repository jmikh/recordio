import './instrument.js';
import * as Sentry from '@sentry/node';
import pg from 'pg';
import { buildApp } from './app.js';
import { createS3Adapter } from './adapters/s3.js';
import { createStripeAdapter } from './adapters/stripe.js';
import { createRenderWorkerAdapter } from './adapters/renderWorker.js';
import { createTranscriptionAdapter } from './adapters/transcription.js';
import { createSupabaseApiAdapter } from './adapters/supabaseApi.js';
import { loadConfig } from './config.js';
import { systemClock } from './deps.js';

const config = loadConfig();

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

/**
 * Real adapters land with the first route that needs them (Wave A onward);
 * until then a port that gets called in production is a routing bug and
 * should fail loudly.
 */
function unimplementedPort<T extends object>(name: string): T {
    return new Proxy({} as T, {
        get: (_target, prop) => () => {
            throw new Error(`${name}.${String(prop)}: adapter not implemented yet`);
        },
    });
}

const s3Configured =
    config.S3_REGION && config.S3_ENDPOINT && config.S3_ACCESS_KEY && config.S3_SECRET_KEY;

const app = buildApp(
    {
        db: pool,
        clock: systemClock,
        stripe: createStripeAdapter({ secretKey: config.STRIPE_SECRET_KEY }),
        mux: unimplementedPort('mux'),
        s3: s3Configured
            ? createS3Adapter({
                  region: config.S3_REGION!,
                  endpoint: config.S3_ENDPOINT!,
                  accessKeyId: config.S3_ACCESS_KEY!,
                  secretAccessKey: config.S3_SECRET_KEY!,
              })
            : unimplementedPort('s3'),
        email: unimplementedPort('email'),
        renderWorker: createRenderWorkerAdapter({
            url: config.RENDER_WORKER_URL,
            secret: config.RENDER_SECRET,
        }),
        transcription: createTranscriptionAdapter({ apiKey: config.OPENAI_API_KEY }),
        supabaseApi: createSupabaseApiAdapter({
            url: config.SUPABASE_URL,
            serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
        }),
    },
    {
        version: config.RAILWAY_GIT_COMMIT_SHA ?? 'dev',
        env: config.NODE_ENV,
        prettyLogs: config.NODE_ENV !== 'production',
        supabaseJwtSecret: config.SUPABASE_JWT_SECRET,
        supabaseUrl: config.SUPABASE_URL,
        stripePriceIds: {
            pro_monthly: config.STRIPE_PRO_PRICE_ID_MONTHLY,
            pro_yearly: config.STRIPE_PRO_PRICE_ID_YEARLY,
            teams_monthly: config.STRIPE_TEAMS_PRICE_ID_MONTHLY,
            teams_yearly: config.STRIPE_TEAMS_PRICE_ID_YEARLY,
        },
    },
);

if (!s3Configured) {
    app.log.warn('S3_REGION/S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY not fully set — s3 port unimplemented, storage routes will 500');
}

Sentry.setupFastifyErrorHandler(app);

// Every Sentry event carries the request_id of the canonical log event
app.addHook('onRequest', async (req) => {
    Sentry.getIsolationScope().setTag('request_id', String(req.id));
});

try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
