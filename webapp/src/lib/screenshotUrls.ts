/**
 * Screenshot URL helpers (plans/screenshots): every screenshot has a
 * permanent slug and lives at /screenshot/{slug} (public viewer) with
 * the editor at /screenshot/{slug}/edit. Sibling of videoUrls.ts.
 */
import { EDITOR_ORIGIN_PROD } from '@shared/types/bridge';

const SCREENSHOT_BASE_URL = import.meta.env.PROD
    ? `${EDITOR_ORIGIN_PROD}/screenshot`
    : 'http://localhost:3001/screenshot';

/** Absolute share link for copy-to-clipboard */
export function screenshotUrl(slug: string): string {
    return `${SCREENSHOT_BASE_URL}/${slug}`;
}

/** Relative editor path for navigate() */
export function screenshotEditPath(slug: string): string {
    return `/screenshot/${slug}/edit`;
}

/** Relative viewer path for navigate() */
export function screenshotViewPath(slug: string): string {
    return `/screenshot/${slug}`;
}

/** /screenshot/{slug}/edit — the editor form of a screenshot URL (auth required) */
export const SCREENSHOT_EDIT_PATH = /^\/screenshot\/([^/]+)\/edit\/?$/;
