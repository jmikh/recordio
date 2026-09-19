/**
 * Cloudflare Pages Function — Mixpanel Reverse Proxy
 *
 * Routes /api/v2/m/* → https://api.mixpanel.com/*
 *
 * Why this path: the same-origin proxy alone is not enough. `/mp/track/` is the
 * literal path Mixpanel's own proxy docs recommend, so filter lists target it
 * directly — under Brave Shields "Aggressive" (which blocks first-party
 * trackers, unlike "Standard") the request dies with ERR_BLOCKED_BY_CLIENT
 * before leaving the page. Confirmed by probe: `/mp/track/?verbose=1&ip=1` is
 * blocked while `/mp/foo?verbose=1&ip=1` and `/api/v2/m/e?verbose=1&ip=1` are
 * not — the match is on the `track/` segment, not the origin or the query.
 *
 * So both the prefix and the endpoint names are neutral: the client sends the
 * ROUTE_ALIASES keys and this function maps them back to Mixpanel's real
 * endpoints. Unknown segments pass through unchanged (flags/, settings/).
 *
 * Geolocation: Forwards the real client IP via X-Real-IP and X-Forwarded-For
 * headers so Mixpanel geolocates correctly (not the CF edge IP).
 * Based on: https://github.com/mixpanel/tracking-proxy/issues/23
 */

/** Neutral endpoint names → Mixpanel's real ones. Must match `api_routes` in webapp/src/analytics. */
const ROUTE_ALIASES: Record<string, string> = {
    e: 'track',
    p: 'engage',
    g: 'groups',
};

interface CFContext {
    request: Request;
    params: { catchall: string[] };
}

export const onRequest = async (context: CFContext) => {
    const { request, params } = context;
    const segments = [...(params.catchall || [])];
    if (segments.length > 0 && ROUTE_ALIASES[segments[0]]) {
        segments[0] = ROUTE_ALIASES[segments[0]];
    }
    const path = segments.join('/');

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
    const targetUrl = `https://api.mixpanel.com/${path}${url.search}`;

    // Create a new request with ALL original headers + body preserved.
    const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
    });

    // Forward real client IP so Mixpanel geolocates correctly.
    // Mixpanel reads X-Forwarded-For for geolocation when ip=1.
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) {
        modifiedRequest.headers.set('X-Real-IP', clientIp);
        modifiedRequest.headers.set('X-Forwarded-For', clientIp);
    }

    try {
        const response = await fetch(modifiedRequest);

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
