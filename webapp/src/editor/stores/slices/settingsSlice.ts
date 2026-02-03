
import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ProjectSettings } from '../../../core/types';
import { isSubset } from '../../utils/subsetMatcher';
import { recalculateAutoZooms, updateManualZoomDuration } from '../../utils/zoomUtils';

type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface SettingsSlice {
    updateSettings: (settings: DeepPartial<ProjectSettings>) => boolean;
}

export const createSettingsSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], SettingsSlice> = (set, _get, store) => ({
    updateSettings: (updates: any) => {
        if ((store as any).temporal.getState().isTracking) {
            console.log('[Action] updateSettings', updates);
        }
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
                // OutputSize is a simple object, can be merged deeply too
                outputSize: {
                    ...currentSettings.outputSize,
                    ...(updates.outputSize || {})
                }
            };

            const nextProject = {
                ...state.project,
                settings: nextSettings,
                updatedAt: new Date()
            };

            // Recalculate Zooms if necessary conditions met
            // 1. Zoom settings changed
            // 2. Padding changed
            let nextActions = state.project.timeline.zoomActions;

            // Check padding inside the now-merged settings or from updates
            // Using merged settings is safer
            const paddingChanged = nextSettings.screen.padding !== currentSettings.screen.padding;

            // Check for any zoom related changes
            const zoomUpdates = updates.zoom || {};
            const zoomChanged = zoomUpdates.maxZoom !== undefined || zoomUpdates.isAuto !== undefined;
            const durationChanged = zoomUpdates.maxZoomDurationMs !== undefined &&
                zoomUpdates.maxZoomDurationMs !== currentSettings.zoom.maxZoomDurationMs;


            // Check for output size changes
            const sizeChanged = nextSettings.outputSize.width !== currentSettings.outputSize.width ||
                nextSettings.outputSize.height !== currentSettings.outputSize.height;

            if (sizeChanged && !nextSettings.zoom.isAuto) {
                nextActions = [];
            } else if ((paddingChanged || zoomChanged || sizeChanged) && nextSettings.zoom.isAuto) {
                nextActions = recalculateAutoZooms(nextProject);
            } else if (durationChanged && !nextSettings.zoom.isAuto) {
                // Manual Zoom Duration Update
                nextActions = updateManualZoomDuration(
                    nextActions,
                    nextSettings.zoom.maxZoomDurationMs
                );
            }

            return {
                project: {
                    ...nextProject,
                    timeline: {
                        ...nextProject.timeline,
                        zoomActions: nextActions
                    }
                }
            };
        });

        return hasChanged;
    }
});
