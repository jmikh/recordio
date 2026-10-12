/**
 * Sentry initialization. Must be imported before anything else in
 * server.ts so the SDK's global handlers (uncaught exceptions, unhandled
 * rejections, console breadcrumbs) are installed first.
 * Reads process.env directly because it runs before config.ts validates it.
 */
import * as Sentry from '@sentry/node';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // Set automatically by Cloud Run per deploy
    release: process.env.K_REVISION,
    initialScope: { tags: { service: 'render-worker' } },
});
