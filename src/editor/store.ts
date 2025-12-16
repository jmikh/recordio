import { create } from 'zustand';

export interface Metadata {
    timestamp: number;
    tagName: string;
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    scrollX: number;
    scrollY: number;
}

export interface Segment {
    id: string;
    sourceStart: number;
    sourceEnd: number;
}

interface EditorState {
    videoUrl: string | null;
    metadata: Metadata[];
    recordingStartTime: number;
    isExporting: boolean;
    zoomIntensity: number;

    // Timeline State
    segments: Segment[];
    maxDuration: number;
    isPlaying: boolean;
    currentTime: number; // Virtual Timeline Time

    setVideoUrl: (url: string | null) => void;
    setMetadata: (metadata: Metadata[]) => void;
    addMetadataItem: (item: Metadata) => void;
    removeMetadataItem: (index: number) => void;
    setRecordingStartTime: (time: number) => void;
    setIsExporting: (isExporting: boolean) => void;
    setZoomIntensity: (intensity: number) => void;

    // Timeline Actions
    initSegments: (durationMs: number) => void;
    splitSegment: (virtualTime: number) => void;
    updateSegment: (id: string, newStart: number, newEnd: number) => void;
    setIsPlaying: (isPlaying: boolean) => void;
    setCurrentTime: (time: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
    videoUrl: null,
    metadata: [],
    recordingStartTime: 0,
    isExporting: false,
    zoomIntensity: 1.0,

    segments: [],
    maxDuration: 0,
    isPlaying: false,
    currentTime: 0,

    setVideoUrl: (url) => set({ videoUrl: url }),
    setMetadata: (metadata) => set({ metadata }),
    addMetadataItem: (item) => set((state) => ({
        metadata: [...state.metadata, item].sort((a, b) => a.timestamp - b.timestamp)
    })),
    removeMetadataItem: (index) => set((state) => ({
        metadata: state.metadata.filter((_, i) => i !== index)
    })),
    setRecordingStartTime: (time) => set({ recordingStartTime: time }),
    setIsExporting: (isExporting) => set({ isExporting }),
    setZoomIntensity: (intensity) => set({ zoomIntensity: intensity }),

    initSegments: (durationMs) => set({
        segments: [{ id: crypto.randomUUID(), sourceStart: 0, sourceEnd: durationMs }],
        maxDuration: durationMs
    }),

    splitSegment: (virtualTime) => set((state) => {
        let currentVirtual = 0;
        const index = state.segments.findIndex(seg => {
            const segDuration = seg.sourceEnd - seg.sourceStart;
            if (virtualTime >= currentVirtual && virtualTime < currentVirtual + segDuration) return true;
            currentVirtual += segDuration;
            return false;
        });

        if (index === -1) {
            // Check if it's right at the end
            if (Math.abs(currentVirtual - virtualTime) < 10) {
                // Ignore splits at the very end
                return state;
            }
            return state;
        }

        const seg = state.segments[index];
        const offset = virtualTime - currentVirtual; // Time into this segment
        const splitPoint = seg.sourceStart + offset;

        // Min segment duration check (e.g. 100ms)
        if (offset < 100 || (seg.sourceEnd - splitPoint) < 100) {
            return state;
        }

        const newSeg1: Segment = { ...seg, sourceEnd: splitPoint };
        const newSeg2: Segment = {
            id: crypto.randomUUID(),
            sourceStart: splitPoint,
            sourceEnd: seg.sourceEnd
        };

        const newSegments = [...state.segments];
        newSegments.splice(index, 1, newSeg1, newSeg2);

        return { segments: newSegments };
    }),

    updateSegment: (id, newStart, newEnd) => set((state) => {
        const segIndex = state.segments.findIndex(s => s.id === id);
        if (segIndex === -1) return state;

        const originalSeg = state.segments[segIndex];

        // 1. Boundary Check: sourceStart >= 0 and sourceEnd <= maxDuration
        let start = Math.max(0, newStart);
        let end = Math.min(state.maxDuration, newEnd);

        // Ensure start < end
        if (start >= end) {
            return state; // Invalid state, ignore
        }

        const newDuration = end - start;

        // 2. Sum Constraint: Sum of all *other* segments + newDuration <= maxDuration
        const otherSegmentsDuration = state.segments.reduce((acc, s) => {
            return s.id === id ? acc : acc + (s.sourceEnd - s.sourceStart);
        }, 0);

        if (otherSegmentsDuration + newDuration > state.maxDuration) {
            // If it exceeds, we need to clamp.
            // But how to clamp? Usually we are modifying one end.
            // If dragging, we prioritize preserving the anchor (start or end) that is NOT moving.
            // However, updateSegment receives the final start/end.

            // Heuristic: If strict sum check fails, we clamp the duration to what's available.
            const allowedDuration = state.maxDuration - otherSegmentsDuration;

            if (newDuration > allowedDuration) {
                // Determine which side changed to decide where to cut
                if (originalSeg.sourceStart !== start) {
                    // Start moved (left handle dragged left), clamp start
                    start = end - allowedDuration;
                } else {
                    // End moved (right handle dragged right), clamp end
                    end = start + allowedDuration;
                }
            }
        }

        // Final sanity check
        start = Math.max(0, start);
        end = Math.min(state.maxDuration, end);
        if (end - start <= 0) return state; // Prevent collapsed segments

        const newSegments = [...state.segments];
        newSegments[segIndex] = { ...originalSeg, sourceStart: start, sourceEnd: end };
        return { segments: newSegments };
    }),

    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setCurrentTime: (time) => set({ currentTime: time }),
}));
