/**
 * Cloudflare Pages Function — Mixpanel Reverse Proxy
 *
 * Routes /mp/* → https://api.mixpanel.com/*
 * Bypasses ad blockers by keeping analytics calls same-origin.
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
