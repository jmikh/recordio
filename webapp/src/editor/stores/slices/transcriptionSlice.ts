import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { CaptionSegment, Word } from '@shared/types';
import { recomputeOutputTimes } from '@shared/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

/** Recomputes output times for caption segments AND their nested words. */
function recomputeCaptionOutputTimes(
    segments: CaptionSegment[],
    timeMapper: InstanceType<typeof import('@shared/mappers/timeMapper').TimeMapper>
): CaptionSegment[] {
    return recomputeOutputTimes(segments, timeMapper).map(segment => ({
        ...segment,
        words: recomputeOutputTimes(segment.words, timeMapper),
    }));
}



export type TranscriptionPhase = 'idle' | 'downloading' | 'generating';

export interface TranscriptionSlice {
    isTranscribing: boolean;
    transcriptionPhase: TranscriptionPhase;
    modelDownloadProgress: number;
    transcriptionProgress: number;
    transcriptionError: string | null;

    setTranscriptionState: (updates: Partial<{ isTranscribing: boolean; transcriptionPhase: TranscriptionPhase; modelDownloadProgress: number; transcriptionProgress: number; transcriptionError: string | null }>) => void;
    setCaptionSegments: (segments: CaptionSegment[], source: { engine: 'local' | 'openai'; language: string }) => void;
    updateCaptionSegment: (segmentId: string, updates: Partial<{ words: Word[]; sourceStartTimeMs: number; sourceEndTimeMs: number }>) => void;
    updateWord: (segmentId: string, wordId: string, updates: Partial<{ word: string; hidden: boolean }>) => void;
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
    transcriptionPhase: 'idle' as TranscriptionPhase,
    modelDownloadProgress: 0,
    transcriptionProgress: 0,
    transcriptionError: null,

    setTranscriptionState: (updates) => {
        set(updates);
    },

    setCaptionSegments: (segments, source) => {
        set(state => {
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeCaptionOutputTimes(segments, timeMapper);
            return ({
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: stamped
                    },
                    settings: {
                        ...state.project.settings,
                        captions: {
                            ...state.project.settings.captions,
                            transcriptionSource: source
                        }
                    },
                    updatedAt: new Date()
                }
            });
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
                        transcriptionSource: undefined
                    }
                },
                updatedAt: new Date()
            },
            transcriptionError: null
        }));
    },

    updateCaptionSegment: (segmentId: string, updates: Partial<{ words: Word[]; sourceStartTimeMs: number; sourceEndTimeMs: number }>) => {
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

            // Stamp output times on segments and their words
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeCaptionOutputTimes(updatedSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: stamped
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    updateWord: (segmentId: string, wordId: string, updates: Partial<{ word: string; hidden: boolean }>) => {
        set(state => {
            const captionSegments = state.project.timeline.captionSegments;
            if (!captionSegments || captionSegments.length === 0) return state;

            const segmentIndex = captionSegments.findIndex(s => s.id === segmentId);
            if (segmentIndex === -1) return state;

            const segment = captionSegments[segmentIndex];
            const wordIndex = segment.words.findIndex(w => w.id === wordId);
            if (wordIndex === -1) return state;

            const updatedWords = [...segment.words];
            updatedWords[wordIndex] = { ...updatedWords[wordIndex], ...updates };

            const updatedSegments = [...captionSegments];
            updatedSegments[segmentIndex] = { ...segment, words: updatedWords };

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
        set(state => {
            const existing = state.project.timeline.captionSegments || [];

            // Delete intersecting captions (same rule as Spotlight)
            const nonOverlapping = existing.filter(s =>
                !(segment.sourceStartTimeMs < s.sourceEndTimeMs && segment.sourceEndTimeMs > s.sourceStartTimeMs)
            );

            // Insert and sort by source start time
            const updatedSegments = [...nonOverlapping, segment].sort(
                (a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs
            );

            // Stamp output times on segments and words
            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeCaptionOutputTimes(updatedSegments, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        captionSegments: stamped
                    },
                    updatedAt: new Date()
                }
            };
        });
    },
});
