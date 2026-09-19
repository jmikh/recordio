/**
 * Cloudflare Pages Function — Mixpanel Reverse Proxy (LEGACY PATH)
 *
 * Routes /mp/* → https://api.mixpanel.com/*
 *
 * DEPRECATED for page traffic — `/mp/track/` is on ad-blocker filter lists and
 * is blocked outright under Brave Shields "Aggressive". Current clients use
 * functions/api/v2/m instead; see that file for the full explanation.
 *
 * Kept alive only for extension versions already in the wild that still post to
 * /mp/track. Those are sent from the extension service worker, which page-level
 * blocking cannot touch, so they still arrive. Remove once the extension
 * version floor has moved past 1.0.20.
 *
 * Geolocation: Forwards the real client IP via X-Real-IP and X-Forwarded-For
 * headers so Mixpanel geolocates correctly (not the CF edge IP).
 * Based on: https://github.com/mixpanel/tracking-proxy/issues/23
 */

interface CFContext {
    request: Request;
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
