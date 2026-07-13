import './instrument.js';
import * as Sentry from '@sentry/node';
import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { systemClock } from './deps.js';

const config = loadConfig();

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

const app = buildApp(
    { db: pool, clock: systemClock },
    {
        version: config.RAILWAY_GIT_COMMIT_SHA ?? 'dev',
        logger: config.NODE_ENV !== 'production'
            ? { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
            : { level: 'info' },
    },
);

Sentry.setupFastifyErrorHandler(app);

try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
