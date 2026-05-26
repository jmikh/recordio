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
 *
 * `functionName` is set as both a tag (filterable in Sentry) and on context,
 * so every edge-function error is attributed to its source function.
 */
export async function captureException(
    err: unknown,
    functionName: string,
    context?: Record<string, unknown>,
): Promise<void> {
    if (!Deno.env.get('SENTRY_DSN')) return;
    initSentry();
    Sentry.setTag('edge_function', functionName);
    Sentry.setContext('extra', { function: functionName, ...(context ?? {}) });
    Sentry.captureException(err);
    await Sentry.flush(2000);
}
