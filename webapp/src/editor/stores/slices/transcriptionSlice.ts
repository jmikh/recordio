import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { CaptionSegment } from '../../../types';


export interface TranscriptionSlice {
    isTranscribing: boolean;
    transcriptionProgress: number;
    transcriptionError: string | null;

    setTranscriptionState: (updates: Partial<{ isTranscribing: boolean; transcriptionProgress: number; transcriptionError: string | null }>) => void;
    setCaptionSegments: (segments: CaptionSegment[]) => void;
    restoreCaptionsFromBaseline: () => void;
    updateCaptionSegment: (segmentId: string, updates: Partial<{ text: string; sourceStartMs: number; sourceEndMs: number }>) => void;
    deleteCaptionSegment: (segmentId: string) => void;
    deleteAllCaptions: () => void;
    addCaptionSegment: (segment: CaptionSegment) => void;
}

export const createTranscriptionSlice: StateCreator<
    ProjectState,
    [['zustand/subscribeWithSelector', never], ['temporal', unknown]],
    [],
    TranscriptionSlice
> = (set, _get, _store) => ({
    isTranscribing: false,
    transcriptionProgress: 0,
    transcriptionError: null,

    setTranscriptionState: (updates) => {
        set(updates);
    },

    setCaptionSegments: (segments) => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    captionSegments: segments
                },
                settings: {
                    ...state.project.settings,
                    captions: {
                        ...state.project.settings.captions,
                        baselineCaptions: segments.map(s => ({ ...s })),
                        generatedAt: new Date()
                    }
                },
                updatedAt: new Date()
            }
        }));
    },

    restoreCaptionsFromBaseline: () => {
        console.log('[Action] restoreCaptionsFromBaseline');
        set(state => {
            const baseline = state.project.settings.captions?.baselineCaptions;
            if (!baseline || baseline.length === 0) {
                console.warn('[TranscriptionSlice] No baseline captions to restore');
                return state;
            }
            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: baseline.map(s => ({ ...s }))
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    deleteAllCaptions: () => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    captionSegments: []
                },
                settings: {
                    ...state.project.settings,
                    captions: {
                        ...state.project.settings.captions,
                        generatedAt: undefined
                    }
                },
                updatedAt: new Date()
            },
            transcriptionError: null
        }));
    },

    updateCaptionSegment: (segmentId: string, updates: Partial<{ text: string; sourceStartMs: number; sourceEndMs: number }>) => {
        set(state => {
            const captionSegments = state.project.timeline.captionSegments;
            if (!captionSegments || captionSegments.length === 0) {
                console.error('[TranscriptionSlice] Cannot update segment - no caption segments exist');
                return state;
            }

            const segmentIndex = captionSegments.findIndex(s => s.id === segmentId);
            if (segmentIndex === -1) {
                console.error('[TranscriptionSlice] Segment not found:', segmentId);
                return state;
            }

            const updatedSegments = [...captionSegments];
            updatedSegments[segmentIndex] = {
                ...updatedSegments[segmentIndex],
                ...updates
            };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: updatedSegments
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    deleteCaptionSegment: (segmentId: string) => {
        set(state => {
            const captionSegments = state.project.timeline.captionSegments;
            if (!captionSegments || captionSegments.length === 0) {
                console.error('[TranscriptionSlice] Cannot delete segment - no caption segments exist');
                return state;
            }

            const updatedSegments = captionSegments.filter(s => s.id !== segmentId);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: updatedSegments
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    addCaptionSegment: (segment: CaptionSegment) => {
        console.log('[Action] addCaptionSegment', segment.id);
        set(state => {
            const existing = state.project.timeline.captionSegments || [];

            // Delete intersecting captions (same rule as Spotlight)
            const nonOverlapping = existing.filter(s =>
                !(segment.sourceStartMs < s.sourceEndMs && segment.sourceEndMs > s.sourceStartMs)
            );

            // Insert and sort by source start time
            const updatedSegments = [...nonOverlapping, segment].sort(
                (a, b) => a.sourceStartMs - b.sourceStartMs
            );

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: updatedSegments
                    },
                    updatedAt: new Date()
                }
            };
        });
    },
});
