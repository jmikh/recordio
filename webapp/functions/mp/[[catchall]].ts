/**
 * Cloudflare Pages Function — Mixpanel Reverse Proxy
 *
 * Routes /mp/* → https://api.mixpanel.com/*
 * Bypasses ad blockers by keeping analytics calls same-origin.
 * Injects client IP directly into event payloads for geolocation accuracy
 * (X-Forwarded-For is unreliable through Cloudflare's outbound fetch).
 */

interface CFContext {
    request: Request;
    params: { catchall: string[] };
}

export const onRequest = async (context: CFContext) => {
    const { request, params } = context;
    const path = (params.catchall || []).join('/');

    const url = new URL(request.url);
    const targetUrl = new URL(`https://api.mixpanel.com/${path}`);
    // Preserve query params (verbose, ip, _ etc.)
    targetUrl.search = url.search;

    const clientIp = request.headers.get('CF-Connecting-IP');

    // For POST /track requests, inject client IP into event payload
    let body: BodyInit | undefined;
    if (request.method === 'POST' && path.startsWith('track') && clientIp) {
        try {
            const json = await request.json();
            const events = Array.isArray(json) ? json : [json];
            for (const event of events) {
                if (event.properties) {
                    event.properties.ip = clientIp;
                }
            }
            body = JSON.stringify(Array.isArray(json) ? events : events[0]);
        } catch {
            // If JSON parsing fails, forward body as-is
            body = request.body ?? undefined;
        }
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = request.body ?? undefined;
    }

    const headers = new Headers();
    headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    headers.set('Accept', request.headers.get('Accept') || 'text/plain');

    try {
        const response = await fetch(targetUrl.toString(), {
            method: request.method,
            headers,
            body,
        });

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (e) {
        console.error('[Mixpanel Proxy] Failed to forward request:', e);
        return new Response('Proxy error', { status: 502 });
    }
};
