/**
 * Project scaling utility.
 *
 * Scales all pixel-based settings proportionally for different export
 * resolutions. Pure computation with no DOM dependencies.
 */

import type { Project, Size, ZoomSegment, SpotlightSegment, CameraMoveSegment } from '../types';
import type { OverlaySegment } from '../types/overlay';

/**
 * Recursively scales any number property ending in 'Px' by the given scale factor.
 * Also handles Rect objects (only if parent field ends in Px) and arrays.
 */
function scalePixelValues(obj: any, scale: number, parentKey: string = ''): any {
    if (obj === null || obj === undefined) return obj;

    // Handle arrays (e.g. spotlight borderRadiusPx: [number, number, number, number])
    if (Array.isArray(obj)) {
        if (parentKey.endsWith('Px')) {
            return obj.map(item => {
                if (typeof item === 'number') return item * scale;
                if (typeof item === 'object') return scalePixelValues(item, scale, parentKey);
                return item;
            });
        }
        return obj.map(item => {
            if (typeof item === 'object') return scalePixelValues(item, scale, parentKey);
            return item;
        });
    }

    // Handle Rect objects - ONLY scale if parent field ends with Px
    if (obj.hasOwnProperty('x') && obj.hasOwnProperty('y') && obj.hasOwnProperty('width') && obj.hasOwnProperty('height')) {
        if (parentKey.endsWith('Px')) {
            return {
                x: obj.x * scale,
                y: obj.y * scale,
                width: obj.width * scale,
                height: obj.height * scale
            };
        }
        return obj;
    }

    // Handle Point objects ({x, y} without width/height) — overlay output coordinates.
    const POINT_FIELDS_TO_SCALE = ['tail', 'head', 'topLeft'];
    if (obj.hasOwnProperty('x') && obj.hasOwnProperty('y') && !obj.hasOwnProperty('width') && POINT_FIELDS_TO_SCALE.includes(parentKey)) {
        return { x: obj.x * scale, y: obj.y * scale };
    }

    if (typeof obj !== 'object') return obj;

    const result: any = {};
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        const value = obj[key];
        if (key.endsWith('Px') && typeof value === 'number') {
            result[key] = value * scale;
        } else if (typeof value === 'object') {
            result[key] = scalePixelValues(value, scale, key);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Scales a project's spatial settings to match a new output size.
 * Used for exporting at different resolutions while maintaining proportions.
 * Automatically scales all fields ending in 'Px' (e.g. borderRadiusPx, widthPx).
 */
export function scaleProject(project: Project, newSize: Size): Project {
    const oldSize = project.settings.outputSize;

    const scaleX = newSize.width / oldSize.width;
    const scaleY = newSize.height / oldSize.height;

    const scaleDiff = Math.abs(scaleX - scaleY);
    const tolerance = 0.001;
    if (scaleDiff > tolerance) {
        console.error(`Scale factors differ: scaleX=${scaleX}, scaleY=${scaleY}, diff=${scaleDiff}`);
    }

    const scale = (scaleX + scaleY) / 2;

    return {
        ...project,
        settings: {
            ...scalePixelValues(project.settings, scale),
            outputSize: { ...newSize },
        },
        timeline: {
            ...project.timeline,
            zoomSegments: project.timeline.zoomSegments.map((za: ZoomSegment) =>
                scalePixelValues(za, scale) as ZoomSegment
            ),
            spotlightSegments: project.timeline.spotlightSegments.map((sa: SpotlightSegment) =>
                scalePixelValues(sa, scale) as SpotlightSegment
            ),
            cameraMoveSegments: (project.timeline.cameraMoveSegments || []).map((cl: CameraMoveSegment) =>
                scalePixelValues(cl, scale) as CameraMoveSegment
            ),
            overlaySegments: (project.timeline.overlaySegments || []).map((ob: OverlaySegment) =>
                scalePixelValues(ob, scale) as OverlaySegment
            ),
        }
    };
}
