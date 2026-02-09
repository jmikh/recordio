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
    splitCaptionSegment: (segmentId: string, splitSourceTimeMs: number) => void;
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
                        baselineCaptions: segments,
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
                        captionSegments: baseline
                    },
                    updatedAt: new Date()
                }
            };
        });
    },

    deleteAllCaptions: () => {
        console.log('[Action] deleteAllCaptions');
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
        console.log('[Action] updateCaptionSegment', segmentId, updates);
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
        console.log('[Action] deleteCaptionSegment', segmentId);
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

    splitCaptionSegment: (segmentId: string, splitSourceTimeMs: number) => {
        console.log('[Action] splitCaptionSegment', segmentId, splitSourceTimeMs);
        set(state => {
            const segments = state.project.timeline.captionSegments;
            if (!segments || segments.length === 0) return state;

            const segmentIndex = segments.findIndex(s => s.id === segmentId);
            if (segmentIndex === -1) return state;

            const segment = segments[segmentIndex];
            const { sourceStartMs, sourceEndMs, text } = segment;

            // Cannot split if the split point is outside the segment
            if (splitSourceTimeMs <= sourceStartMs || splitSourceTimeMs >= sourceEndMs) {
                console.warn('[TranscriptionSlice] Split point outside segment bounds');
                return state;
            }

            // Proportional text split based on time position
            const ratio = (splitSourceTimeMs - sourceStartMs) / (sourceEndMs - sourceStartMs);
            const words = text.split(/\s+/);
            const splitWordIndex = Math.max(1, Math.round(words.length * ratio));

            const firstText = words.slice(0, splitWordIndex).join(' ');
            const secondText = words.slice(splitWordIndex).join(' ');

            const firstSegment: CaptionSegment = {
                id: segment.id,
                text: firstText,
                sourceStartMs: sourceStartMs,
                sourceEndMs: splitSourceTimeMs,
            };

            const secondSegment: CaptionSegment = {
                id: crypto.randomUUID(),
                text: secondText,
                sourceStartMs: splitSourceTimeMs,
                sourceEndMs: sourceEndMs,
            };

            const updatedSegments = [...segments];
            updatedSegments.splice(segmentIndex, 1, firstSegment, secondSegment);

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
