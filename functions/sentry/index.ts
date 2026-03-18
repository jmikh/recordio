/**
 * Cloudflare Pages Function — Sentry Tunnel
 *
 * Routes POST /sentry → Sentry ingest endpoint.
 * Bypasses ad blockers by keeping error reporting calls same-origin.
 *
 * The Sentry SDK sends "envelopes" to the tunnel URL. This function parses
 * the DSN from the envelope header, validates it against an allowlist, and
 * forwards the raw envelope to Sentry's ingest endpoint.
 *
 * Based on: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */

// Only allow our own Sentry project — prevents abuse as an open relay
const ALLOWED_SENTRY_HOSTS = ['o4510721001521152.ingest.us.sentry.io'];

interface CFContext {
    request: Request;
}

export const onRequest = async (context: CFContext) => {
    const { request } = context;

    // Only accept POST (envelopes)
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const body = await request.text();
        const firstLine = body.split('\n')[0];
        const header = JSON.parse(firstLine);

        // Extract the DSN to determine the correct ingest URL
        const dsn = new URL(header.dsn);
        const projectId = dsn.pathname.replace('/', '');
        const sentryHost = dsn.hostname;

        // Validate against our allowlist to prevent open relay abuse
        if (!ALLOWED_SENTRY_HOSTS.includes(sentryHost)) {
            return new Response('Invalid Sentry host', { status: 403 });
        }

        const sentryUrl = `https://${sentryHost}/api/${projectId}/envelope/`;

        const response = await fetch(sentryUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-sentry-envelope',
            },
            body,
        });

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (e) {
        console.error('[Sentry Tunnel] Failed to forward envelope:', e);
        return new Response('Tunnel error', { status: 500 });
    }
};
