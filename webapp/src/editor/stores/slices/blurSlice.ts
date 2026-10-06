import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID, BlurRegion, BlurSegment } from '@shared/types';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface BlurSlice {
    addBlurSegment: (segment: BlurSegment) => void;
    updateBlurSegment: (id: ID, updates: Partial<Pick<BlurSegment, 'sourceStartTimeMs' | 'sourceEndTimeMs' | 'blurRadiusPx'>>) => void;
    deleteBlurSegment: (id: ID) => void;
    addBlurRegion: (segmentId: ID, region: BlurRegion) => void;
    updateBlurRegion: (segmentId: ID, regionId: ID, updates: Partial<Omit<BlurRegion, 'id'>>) => void;
    /** Removes a region; removing a segment's last region removes the segment too. */
    deleteBlurRegion: (segmentId: ID, regionId: ID) => void;
    toggleBlurEnabled: () => void;
}

export const createBlurSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], BlurSlice> = (set) => {
    /** Replaces one segment via `fn` (no time change, so output times stay valid). */
    const mapSegment = (segmentId: ID, fn: (segment: BlurSegment) => BlurSegment | null) => {
        set(state => {
            const blurSegments = state.project.timeline.blurSegments;
            const idx = blurSegments.findIndex(s => s.id === segmentId);
            if (idx === -1) return state;

            const next = fn(blurSegments[idx]);
            const nextSegments = next
                ? blurSegments.map((s, i) => (i === idx ? next : s))
                : blurSegments.filter((_, i) => i !== idx);

            return {
                project: {
                    ...state.project,
                    timeline: { ...state.project.timeline, blurSegments: nextSegments },
                },
            };
        });
    };

    return {
        addBlurSegment: (segment) => {
            set(state => {
                const blurSegments = [...state.project.timeline.blurSegments, segment]
                    .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

                const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
                const stamped = recomputeOutputTimes(blurSegments, timeMapper);

                return {
                    project: {
                        ...state.project,
                        timeline: { ...state.project.timeline, blurSegments: stamped },
                    },
                };
            });
        },

        updateBlurSegment: (id, updates) => {
            set(state => {
                const blurSegments = state.project.timeline.blurSegments;
                const idx = blurSegments.findIndex(s => s.id === id);
                if (idx === -1) return state;

                const nextSegments = [...blurSegments];
                nextSegments[idx] = { ...nextSegments[idx], ...updates };
                nextSegments.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

                const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
                const stamped = recomputeOutputTimes(nextSegments, timeMapper);

                return {
                    project: {
                        ...state.project,
                        timeline: { ...state.project.timeline, blurSegments: stamped },
                    },
                };
            });
        },

        deleteBlurSegment: (id) => mapSegment(id, () => null),

        addBlurRegion: (segmentId, region) => mapSegment(segmentId, segment => ({
            ...segment,
            regions: [...segment.regions, region],
        })),

        updateBlurRegion: (segmentId, regionId, updates) => mapSegment(segmentId, segment => ({
            ...segment,
            regions: segment.regions.map(r => (r.id === regionId ? { ...r, ...updates } : r)),
        })),

        deleteBlurRegion: (segmentId, regionId) => mapSegment(segmentId, segment => {
            const regions = segment.regions.filter(r => r.id !== regionId);
            return regions.length > 0 ? { ...segment, regions } : null;
        }),

        toggleBlurEnabled: () => {
            set(state => ({
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        blur: { ...state.project.settings.blur, enabled: !(state.project.settings.blur?.enabled ?? true) },
                    },
                },
            }));
        },
    };
};
