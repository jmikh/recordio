/**
 * Video URL helpers (share-access model): every project has a permanent
 * slug and lives at /video/{slug} (public viewer, /view alias) with the
 * editor at /video/{slug}/edit. The copied share link stays the short
 * absolute form.
 */
import { EDITOR_ORIGIN_PROD } from '@shared/types/bridge';

const VIDEO_BASE_URL = import.meta.env.PROD
    ? `${EDITOR_ORIGIN_PROD}/video`
    : 'http://localhost:3001/video';

/** Absolute share link for copy-to-clipboard */
export function videoUrl(slug: string): string {
    return `${VIDEO_BASE_URL}/${slug}`;
}

/** Relative editor path for navigate() */
export function editorPath(slug: string): string {
    return `/video/${slug}/edit`;
}

/** Relative viewer path for navigate() */
export function viewPath(slug: string): string {
    return `/video/${slug}`;
}
