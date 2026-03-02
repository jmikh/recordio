
import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ProjectSettings, CameraSettings, CameraLayoutSegment } from '../../../types';
import type { Size } from '@shared/types';
import { isSubset } from '../../utils/subsetMatcher';
import { getCameraAnchor, type CameraAnchor } from '../../../core/zoom/cameraAnimator';

type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface SettingsSlice {
    updateSettings: (settings: DeepPartial<ProjectSettings>) => boolean;
}

export const createSettingsSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], SettingsSlice> = (set, _get, store) => ({
    updateSettings: (updates: any) => {
        let hasChanged = false; // Capture change status

        set((state) => {
            const currentSettings = state.project.settings;

            // OPTIMIZATION: Check if incoming updates are already satisfied by current state
            if (isSubset(currentSettings, updates)) {
                // No real changes
                return state;
            }

            // If we are here, changes exist
            hasChanged = true;

            // Deep merge known nested objects
            // We use the existing setting as base, and merge updates on top
            // This handles both "full object replacement" (if spread by caller) and "partial update"

            const nextSettings: ProjectSettings = {
                ...currentSettings,
                ...updates,
                // Specialized deep merges for nested objects
                background: {
                    ...currentSettings.background,
                    ...(updates.background || {})
                },
                screen: {
                    ...currentSettings.screen,
                    ...(updates.screen || {})
                },
                zoom: {
                    ...currentSettings.zoom,
                    ...(updates.zoom || {})
                },
                camera: {
                    ...currentSettings.camera,
                    ...(updates.camera || {})
                },
                captions: {
                    ...currentSettings.captions,
                    ...(updates.captions || {})
                },
                audio: {
                    ...currentSettings.audio,
                    ...(updates.audio || {}),
                    music: {
                        ...currentSettings.audio?.music,
                        ...(updates.audio?.music || {}),
                    },
                },
                // OutputSize is a simple object, can be merged deeply too
                outputSize: {
                    ...currentSettings.outputSize,
                    ...(updates.outputSize || {})
                },
            };

            const nextProject = {
                ...state.project,
                settings: nextSettings,
                updatedAt: new Date()
            };

            // Clear zoom segments when output size changes (rects are invalid)
            const sizeChanged = nextSettings.outputSize.width !== currentSettings.outputSize.width ||
                nextSettings.outputSize.height !== currentSettings.outputSize.height;
            const nextZoomSegments = sizeChanged ? [] : state.project.timeline.zoomSegments;

            // Reposition camera and camera layout segments when output size changes
            if (sizeChanged && nextSettings.camera) {
                const oldSize = currentSettings.outputSize;
                const newSize = nextSettings.outputSize;
                const cam = nextSettings.camera;

                nextSettings.camera = repositionCamera(cam, oldSize, newSize);

                // Also reposition camera layout segments
                if (nextProject.timeline.cameraLayoutSegments?.length) {
                    nextProject.timeline = {
                        ...nextProject.timeline,
                        cameraLayoutSegments: nextProject.timeline.cameraLayoutSegments.map(seg =>
                            repositionCameraLayoutSegment(seg, oldSize, newSize)
                        )
                    };
                }
            }

            return {
                project: {
                    ...nextProject,
                    timeline: {
                        ...nextProject.timeline,
                        zoomSegments: nextZoomSegments
                    }
                }
            };
        });

        return hasChanged;
    }
});

/**
 * Repositions a camera-like rect from oldSize to newSize,
 * preserving the distance to the nearest edges (anchor corner).
 */
function repositionByAnchor(
    x: number, y: number, w: number, h: number,
    oldSize: Size, newSize: Size
): { x: number; y: number } {
    const anchor: CameraAnchor = getCameraAnchor(
        { xPx: x, yPx: y, widthPx: w, heightPx: h },
        oldSize
    );

    // Compute edge distances in old space
    const distLeft = x;
    const distRight = oldSize.width - (x + w);
    const distTop = y;
    const distBottom = oldSize.height - (y + h);

    // Apply the anchor's edge distances in new space
    let newX: number;
    let newY: number;

    switch (anchor) {
        case 'top-left':
            newX = distLeft;
            newY = distTop;
            break;
        case 'top-right':
            newX = newSize.width - w - distRight;
            newY = distTop;
            break;
        case 'bottom-left':
            newX = distLeft;
            newY = newSize.height - h - distBottom;
            break;
        case 'bottom-right':
            newX = newSize.width - w - distRight;
            newY = newSize.height - h - distBottom;
            break;
    }

    // Clamp to stay within bounds
    newX = Math.max(0, Math.min(newX, newSize.width - w));
    newY = Math.max(0, Math.min(newY, newSize.height - h));

    return { x: newX, y: newY };
}

function repositionCamera(
    cam: CameraSettings,
    oldSize: Size, newSize: Size
): CameraSettings {
    const { x, y } = repositionByAnchor(
        cam.xPx, cam.yPx, cam.widthPx, cam.heightPx,
        oldSize, newSize
    );
    return { ...cam, xPx: x, yPx: y };
}

function repositionCameraLayoutSegment(
    seg: CameraLayoutSegment,
    oldSize: Size, newSize: Size
): CameraLayoutSegment {
    const { x, y } = repositionByAnchor(
        seg.xPx, seg.yPx, seg.widthPx, seg.heightPx,
        oldSize, newSize
    );
    return { ...seg, xPx: x, yPx: y };
}
