/**
 * Factories for new blur segments and regions (timeline ghost block,
 * toolbar "Add blur" button, inspector "Add region").
 */
import type { BlurRegion, BlurSegment, Size } from '@shared/types';
import type { TimeMapper } from '@shared/mappers/timeMapper';

/** Default blur intensity for a new segment (output pixels). */
export const DEFAULT_BLUR_RADIUS_PX = 20;
export const MIN_BLUR_RADIUS_PX = 3;
export const MAX_BLUR_RADIUS_PX = 50;

/** Smallest region side, as a fraction of the output's shorter side. */
export const MIN_BLUR_REGION_FRACTION = 0.04;

/**
 * A new region centred in the output frame. `index` (the number of regions
 * already in the segment) nudges it diagonally so a second region doesn't
 * land exactly on top of the first.
 */
export function createDefaultBlurRegion(outputSize: Size, index = 0): BlurRegion {
    const { width: W, height: H } = outputSize;
    const w = Math.round(W * 0.15);
    const h = Math.round(H * 0.12);
    const step = (index % 5) * 0.04;
    return {
        id: crypto.randomUUID(),
        rectPx: {
            x: Math.round((W - w) / 2 + W * step),
            y: Math.round((H - h) / 2 + H * step),
            width: w,
            height: h,
        },
        borderRadiusPx: [0, 0, 0, 0],
    };
}

/** A new single-region blur segment covering the given output-time range. */
export function createBlurSegment(
    outputStartTimeMs: number,
    outputEndTimeMs: number,
    timeMapper: TimeMapper,
    outputSize: Size,
): BlurSegment {
    return {
        id: crypto.randomUUID(),
        sourceStartTimeMs: timeMapper.mapOutputToSourceTime(outputStartTimeMs),
        sourceEndTimeMs: timeMapper.mapOutputToSourceTime(outputEndTimeMs),
        outputStartTimeMs,
        outputEndTimeMs,
        visible: true,
        blurRadiusPx: DEFAULT_BLUR_RADIUS_PX,
        regions: [createDefaultBlurRegion(outputSize)],
    };
}
