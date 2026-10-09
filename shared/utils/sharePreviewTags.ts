/**
 * The link-preview tags (og:* / twitter:*) for a shared video page —
 * built by the Cloudflare Pages Function functions/video/[slug].ts and
 * injected into the SPA shell, because unfurl bots (Slack, iMessage,
 * LinkedIn…) don't run JavaScript. plans/share-link-previews-oneshot.md.
 *
 * Dependency-free apart from formatDuration: the Pages Function bundles
 * it by relative path.
 */
import { formatDuration } from './formatDuration';

/** /shared-video-preview's 200 body; null = not public (or unknown) */
export interface SharePreviewMeta {
    name: string;
    ownerName: string;
    durationMs?: number;
}

export interface SharePreviewUrls {
    /** Canonical page URL, https://{host}/video/{slug} */
    pageUrl: string;
    /** /shared-video-preview-image/{slug} — serves the generic card for non-public slugs too */
    imageUrl: string;
}

export interface SharePreview {
    /** Plain text for <title> — the caller sets it as text, not HTML */
    title: string;
    /** Escaped <meta> tags to append to <head> */
    headHtml: string;
}

export const PREVIEW_IMAGE_WIDTH = 1200;
export const PREVIEW_IMAGE_HEIGHT = 675;

/**
 * Same wording for private, workspace and unknown slugs: the preview must
 * not reveal which one it is, nor a private video's title.
 */
const GENERIC = {
    title: 'Recordio',
    ogTitle: 'Recordio video',
    description: 'This video is shared privately. Sign in to Recordio to watch.',
    imageAlt: 'Recordio',
};

function escapeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function buildSharePreview(meta: SharePreviewMeta | null, urls: SharePreviewUrls): SharePreview {
    const ogTitle = meta ? meta.name : GENERIC.ogTitle;
    const description = meta
        ? [meta.ownerName, meta.durationMs !== undefined ? formatDuration(meta.durationMs) : null]
            .filter(Boolean)
            .join(' · ')
        : GENERIC.description;

    const tags: Array<[attr: 'name' | 'property', key: string, value: string]> = [
        ['name', 'description', description],
        ['property', 'og:site_name', 'Recordio'],
        ['property', 'og:type', meta ? 'video.other' : 'website'],
        ['property', 'og:url', urls.pageUrl],
        ['property', 'og:title', ogTitle],
        ['property', 'og:description', description],
        ['property', 'og:image', urls.imageUrl],
        ['property', 'og:image:type', 'image/png'],
        ['property', 'og:image:width', String(PREVIEW_IMAGE_WIDTH)],
        ['property', 'og:image:height', String(PREVIEW_IMAGE_HEIGHT)],
        ['property', 'og:image:alt', meta ? meta.name : GENERIC.imageAlt],
        ['name', 'twitter:card', 'summary_large_image'],
        ['name', 'twitter:title', ogTitle],
        ['name', 'twitter:description', description],
        ['name', 'twitter:image', urls.imageUrl],
    ];

    return {
        title: meta ? `${meta.name} · Recordio` : GENERIC.title,
        headHtml: tags
            .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttribute(value)}">`)
            .join('\n'),
    };
}
