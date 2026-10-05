/**
 * Export quality definitions shared between browser and server rendering.
 */

import type { Size } from '../types';

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';

/** Output frame rate. With VFR export this is the maximum rate. */
export type ExportFps = 30 | 60;

/** What the user picks in the download dialog. */
export type ExportResolutionChoice = 'HD' | '4K';

export function getHeightForQuality(q: ExportQuality): number {
    switch (q) {
        case '480p': return 480;
        case '720p': return 720;
        case '1080p': return 1080;
        case '2K': return 1440;
        case '4K': return 2160;
    }
}

/**
 * The quality a render is made at for a user's choice.
 *
 * HD always renders 1080p. 4K renders at the smallest tier that holds the
 * recording without shrinking it — upscaling a smaller recording to 4K adds
 * no detail, only export time. The recording's size is measured in output
 * rows: a recording wider than the output's aspect ratio is limited by its
 * width, so `width × outputHeight / outputWidth` can exceed its height.
 */
export function resolveExportQuality(
    choice: ExportResolutionChoice,
    recordingSize: Size,
    outputSize: Size,
): ExportQuality {
    if (choice === 'HD') return '1080p';

    const neededHeight = Math.max(
        recordingSize.height,
        recordingSize.width * (outputSize.height / outputSize.width),
    );
    if (neededHeight <= 1080) return '1080p';
    if (neededHeight <= 1440) return '2K';
    return '4K';
}
