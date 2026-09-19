/**
 * Cloudflare Pages Function — Sentry Tunnel (LEGACY PATH)
 *
 * `/sentry` is on ad-blocker filter lists; current clients tunnel to
 * /api/v2/l instead. Kept only for extension versions already in the wild —
 * their envelopes are sent from the service worker, which page-level blocking
 * cannot touch. Remove once the extension version floor has moved past 1.0.20.
 */
export { onRequest } from '../api/v2/l/index';
