import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';


export interface TranscriptionSlice {
    isTranscribing: boolean;
    transcriptionProgress: number;
    transcriptionError: string | null;

    setTranscriptionState: (updates: Partial<{ isTranscribing: boolean; transcriptionProgress: number; transcriptionError: string | null }>) => void;
    setCaptions: (captions: import('../../../core/types').Captions) => void;
    updateCaptionSegment: (segmentId: string, updates: Partial<{ text: string; sourceStartMs: number; sourceEndMs: number }>) => void;
    deleteCaptionSegment: (segmentId: string) => void;
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

    setCaptions: (captions) => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    recording: {
                        ...state.project.timeline.recording,
                        captions
                    }
                },
                updatedAt: new Date()
            }
        }));
    },

    deleteTranscription: () => {
        console.log('[Action] deleteTranscription');
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    recording: {
                        ...state.project.timeline.recording,
                        captions: undefined
                    }
                },
                updatedAt: new Date()
            },
            transcriptionError: null
        }));
    },

    updateCaptionSegment: (segmentId: string, updates: Partial<{ text: string; sourceStartMs: number; sourceEndMs: number }>) => {
        console.log('[Action] updateCaptionSegment', segmentId, updates);
        set(state => {
            const captions = state.project.timeline.recording.captions;
            if (!captions) {
                console.error('[TranscriptionSlice] Cannot update segment - no captions exist');
                return state;
            }

            const segmentIndex = captions.segments.findIndex(s => s.id === segmentId);
            if (segmentIndex === -1) {
                console.error('[TranscriptionSlice] Segment not found:', segmentId);
                return state;
            }

            const updatedSegments = [...captions.segments];
            updatedSegments[segmentIndex] = {
                ...updatedSegments[segmentIndex],
                ...updates
            };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        recording: {
                            ...state.project.timeline.recording,
                            captions: {
                                ...captions,
                                segments: updatedSegments
                            }
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    deleteCaptionSegment: (segmentId: string) => {
        console.log('[Action] deleteCaptionSegment', segmentId);
        set(state => {
            const captions = state.project.timeline.recording.captions;
            if (!captions) {
                console.error('[TranscriptionSlice] Cannot delete segment - no captions exist');
                return state;
            }

            const updatedSegments = captions.segments.filter(s => s.id !== segmentId);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        recording: {
                            ...state.project.timeline.recording,
                            captions: {
                                ...captions,
                                segments: updatedSegments
                            }
                        }
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

});
