/**
 * Sentry initialization. Must be imported before anything else in
 * server.ts so auto-instrumentation can hook module loading.
 * Reads process.env directly for the same reason. Not imported by tests.
 */
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? 'development',
        release: process.env.RAILWAY_GIT_COMMIT_SHA,
        // 100% at current traffic — exact per-route counts, no new vendor
        tracesSampleRate: 1.0,
    });
}
