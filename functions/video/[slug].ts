/**
 * Cloudflare Pages Function — link previews for shared videos
 * (plans/share-link-previews-oneshot.md)
 *
 * Routes GET /video/{slug} (exactly one segment — /video/{slug}/edit is
 * untouched). Unfurl bots (Slack, iMessage, LinkedIn…) don't run
 * JavaScript, so the og:/twitter: tags must be in the HTML itself: this
 * serves the SPA shell as usual and injects the tags for the slug.
 *
 * Data comes from the API's POST /shared-video-preview (public shares
 * only; anything else 404s and gets the generic card). og:image points at
 * the API's GET /shared-video-preview-image/{slug}.
 *
 * The page must never break because the preview did: any failure
 * (API_URL unset, timeout, 5xx, bad JSON) serves the shell unchanged.
 *
 * Env: API_URL — the Fastify server's public URL, no trailing slash
 * (Pages project settings; `.dev.vars` for `wrangler pages dev`).
 */
import { buildSharePreview, type SharePreviewMeta } from '../../shared/utils/sharePreviewTags';

/** Preview lookups slower than this serve the page without tags */
const LOOKUP_TIMEOUT_MS = 1500;
/** Edge-cache each slug's lookup — normal page views come through here too */
const CACHE_TTL_SECONDS = 60;

interface Env {
    API_URL?: string;
}

interface CFContext {
    request: Request;
    params: { slug: string };
    env: Env;
    next: () => Promise<Response>;
    waitUntil: (promise: Promise<unknown>) => void;
}

/** Workers runtime globals (no @cloudflare/workers-types in this repo) */
interface RewriterElement {
    setInnerContent(content: string, options?: { html: boolean }): void;
    append(content: string, options?: { html: boolean }): void;
}
declare class HTMLRewriter {
    on(selector: string, handlers: { element(element: RewriterElement): void }): HTMLRewriter;
    transform(response: Response): Response;
}

/** The slug's preview metadata; null when it isn't a public share. Throws on any other failure. */
async function loadPreview(context: CFContext, apiUrl: string, slug: string): Promise<SharePreviewMeta | null> {
    const cache = (caches as unknown as { default: Cache }).default;
    // Synthetic GET key — the Cache API only stores GETs
    const cacheKey = new Request(`https://shared-video-preview.internal/${encodeURIComponent(slug)}`);

    const cached = await cache.match(cacheKey);
    if (cached) return (await cached.json() as { meta: SharePreviewMeta | null }).meta;

    const res = await fetch(`${apiUrl}/shared-video-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    let meta: SharePreviewMeta | null;
    if (res.status === 404) {
        meta = null;
    } else if (res.ok) {
        meta = await res.json() as SharePreviewMeta;
    } else {
        throw new Error(`shared-video-preview responded ${res.status}`);
    }

    context.waitUntil(cache.put(cacheKey, new Response(JSON.stringify({ meta }), {
        headers: {
            'content-type': 'application/json',
            'cache-control': `max-age=${CACHE_TTL_SECONDS}`,
        },
    })));
    return meta;
}

export const onRequestGet = async (context: CFContext): Promise<Response> => {
    const response = await context.next();
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) {
        return response;
    }

    const apiUrl = context.env.API_URL;
    if (!apiUrl) {
        console.error('[video-preview] API_URL is not configured; serving the page without preview tags');
        return response;
    }

    const { slug } = context.params;
    let meta: SharePreviewMeta | null;
    try {
        meta = await loadPreview(context, apiUrl, slug);
    } catch (err) {
        console.error('[video-preview] preview lookup failed; serving the page without preview tags', err);
        return response;
    }

    const origin = new URL(context.request.url).origin;
    const preview = buildSharePreview(meta, {
        pageUrl: `${origin}/video/${encodeURIComponent(slug)}`,
        imageUrl: `${apiUrl}/shared-video-preview-image/${encodeURIComponent(slug)}`,
    });

    return new HTMLRewriter()
        // Text mode: the title is user content
        .on('title', { element: (el) => el.setInnerContent(preview.title) })
        .on('head', { element: (el) => el.append(preview.headHtml, { html: true }) })
        .transform(response);
};
