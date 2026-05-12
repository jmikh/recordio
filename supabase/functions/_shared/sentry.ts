import * as Sentry from 'https://deno.land/x/sentry/index.mjs';

let initialized = false;

function initSentry() {
    if (initialized) return;
    const dsn = Deno.env.get('SENTRY_DSN');
    if (!dsn) return;
    Sentry.init({ dsn, tracesSampleRate: 0 });
    initialized = true;
}

/**
 * Captures an exception in Sentry and flushes before returning.
 * Must be awaited before sending the HTTP response — edge functions
 * terminate immediately after the response, dropping any pending async work.
 */
export async function captureException(
    err: unknown,
    context?: Record<string, unknown>,
): Promise<void> {
    if (!Deno.env.get('SENTRY_DSN')) return;
    initSentry();
    if (context) Sentry.setContext('extra', context);
    Sentry.captureException(err);
    await Sentry.flush(2000);
}
