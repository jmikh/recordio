import './instrument.js';
import * as Sentry from '@sentry/node';
import pg from 'pg';
import { buildApp } from './app.js';
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

const app = buildApp(
    {
        db: pool,
        clock: systemClock,
        stripe: unimplementedPort('stripe'),
        mux: unimplementedPort('mux'),
        s3: unimplementedPort('s3'),
        email: unimplementedPort('email'),
        renderWorker: unimplementedPort('renderWorker'),
        transcription: unimplementedPort('transcription'),
        supabaseApi: unimplementedPort('supabaseApi'),
    },
    {
        version: config.RAILWAY_GIT_COMMIT_SHA ?? 'dev',
        env: config.NODE_ENV,
        prettyLogs: config.NODE_ENV !== 'production',
        supabaseJwtSecret: config.SUPABASE_JWT_SECRET,
        supabaseUrl: config.SUPABASE_URL,
    },
);

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
