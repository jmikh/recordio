/**
 * A video length as players show it: `m:ss`, or `h:mm:ss` from an hour
 * up. Floors to the second, like the player's own duration readout.
 *
 * Dependency-free on purpose: the Cloudflare Pages Function
 * (functions/video/[slug].ts) bundles it alongside the server.
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const ss = s.toString().padStart(2, '0');
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
