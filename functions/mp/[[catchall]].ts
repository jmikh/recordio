/**
 * Cloudflare Pages Function — Mixpanel Reverse Proxy
 *
 * Routes /mp/* → https://api.mixpanel.com/*
 * Bypasses ad blockers by keeping analytics calls same-origin.
 * Injects client IP directly into event payloads for geolocation accuracy
 * (X-Forwarded-For is unreliable through Cloudflare's outbound fetch).
 */

interface CFContext {
    request: Request & {
        cf?: {
            city?: string;
            region?: string;
            regionCode?: string;
            country?: string;
            latitude?: string;
            longitude?: string;
            timezone?: string;
        };
    };
    params: { catchall: string[] };
}

export const onRequest = async (context: CFContext) => {
    const { request, params } = context;
    const path = (params.catchall || []).join('/');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    const url = new URL(request.url);
    const targetUrl = new URL(`https://api.mixpanel.com/${path}`);
    // Preserve query params (verbose, ip, _ etc.)
    targetUrl.search = url.search;
    // Don't let Mixpanel use the proxy IP for geo — we inject geo explicitly
    targetUrl.searchParams.set('ip', '0');

    const clientIp = request.headers.get('CF-Connecting-IP');
    const cf = request.cf;

    // For POST /track requests, inject Cloudflare geo properties directly.
    // request.cf contains geolocation resolved from the real client IP.
    // Clone request first — consuming the body is irreversible.
    let body: BodyInit | undefined;
    let contentType = request.headers.get('Content-Type') || 'application/json';

    if (request.method === 'POST' && path.startsWith('track')) {
        const cloned = request.clone();
        try {
            const text = await request.text();
            const json = JSON.parse(text);
            const events = Array.isArray(json) ? json : [json];
            for (const event of events) {
                if (event.properties) {
                    // Inject real client IP
                    if (clientIp) event.properties.$ip = clientIp;
                    // Inject Cloudflare-resolved geo (more accurate than IP geo)
                    if (cf?.city) event.properties.$city = cf.city;
                    if (cf?.region) event.properties.$region = cf.region;
                    if (cf?.country) event.properties.mp_country_code = cf.country;
                }
            }
            body = JSON.stringify(Array.isArray(json) ? events : events[0]);
            contentType = 'application/json';
        } catch {
            // JSON parsing failed — forward the cloned body as-is
            body = cloned.body ?? undefined;
        }
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = request.body ?? undefined;
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
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
