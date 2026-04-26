/**
 * Export quality definitions shared between browser and server rendering.
 */

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';

export function getHeightForQuality(q: ExportQuality): number {
    switch (q) {
        case '480p': return 480;
        case '720p': return 720;
        case '1080p': return 1080;
        case '2K': return 1440;
        case '4K': return 2160;
    }
}
