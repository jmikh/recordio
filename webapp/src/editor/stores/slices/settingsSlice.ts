
import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ProjectSettings } from '../../../types';
import { isSubset } from '../../utils/subsetMatcher';

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
                }
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
