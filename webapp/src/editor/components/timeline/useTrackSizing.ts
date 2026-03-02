import { useMemo } from 'react';
import { useUIStore, type TrackVisibility } from '../../stores/useUIStore';
import { useProjectStore } from '../../stores/useProjectStore';

// ============================================================================
// TRACK SIZING HOOK
// Computes per-track heights for the hover-to-expand timeline system.
//
// Rules:
// 1. Recording is ALWAYS full height — never collapses
// 2. When no track is hovered → the first visible non-recording track is full height
// 3. When a track is hovered → that track becomes full height
// 4. All other non-recording tracks collapse to COLLAPSED_HEIGHT
// ============================================================================

/** Full track height (same as existing TRACK_HEIGHT) */
export const TRACK_HEIGHT = 32;

/** Collapsed track height (~40% of full) */
export const COLLAPSED_HEIGHT = 13;

/** Track ordering — determines which track gets default "full" status */
const TRACK_ORDER: (keyof TrackVisibility)[] = [
    'recording',
    'zoom',
    'spotlight',
    'captions',
    'cameraLayout',
];

/** Gap between track rows */
export const TRACK_GAP = 4;

/** Ruler height (24px canvas + 2px borders) */
const RULER_HEIGHT = 26;

export interface TrackSizeInfo {
    height: number;
    isCollapsed: boolean;
}

export interface TrackSizingResult {
    tracks: Record<keyof TrackVisibility, TrackSizeInfo>;
    /** Deterministic total height for all visible tracks including gaps and padding */
    totalHeight: number;
}

export function useTrackSizing(): TrackSizingResult {
    const trackVisibility = useUIStore(s => s.trackVisibility);
    const hoveredTrack = useUIStore(s => s.hoveredTrack);
    const hasCameraSource = useProjectStore(s => !!s.project.cameraSource);

    return useMemo(() => {
        // Determine which non-recording tracks are actually visible
        const visibleNonRecording = TRACK_ORDER.filter(key => {
            if (key === 'recording') return false;
            if (key === 'cameraLayout' && !hasCameraSource) return false;
            return trackVisibility[key];
        });

        // Default expanded track: first visible non-recording track (usually 'zoom')
        const defaultExpanded = visibleNonRecording[0] ?? null;

        // The "active" expanded track (besides recording)
        const expandedTrack = hoveredTrack && hoveredTrack !== 'recording' && trackVisibility[hoveredTrack]
            ? hoveredTrack
            : defaultExpanded;

        const tracks = {} as Record<keyof TrackVisibility, TrackSizeInfo>;

        for (const key of TRACK_ORDER) {
            if (key === 'recording') {
                tracks[key] = { height: TRACK_HEIGHT, isCollapsed: false };
            } else if (key === expandedTrack) {
                tracks[key] = { height: TRACK_HEIGHT, isCollapsed: false };
            } else {
                tracks[key] = { height: COLLAPSED_HEIGHT, isCollapsed: true };
            }
        }

        // Deterministic total height:
        // RULER + Recording (always TRACK_HEIGHT) + 1 expanded non-recording (TRACK_HEIGHT)
        // + remaining collapsed (COLLAPSED_HEIGHT each) + gaps + top/bottom padding
        const isRecordingVisible = trackVisibility.recording;
        const visibleCount = (isRecordingVisible ? 1 : 0) + visibleNonRecording.length;
        const collapsedCount = Math.max(0, visibleNonRecording.length - 1); // 1 is expanded
        const expandedCount = visibleNonRecording.length > 0 ? 1 : 0;
        const totalHeight = RULER_HEIGHT
            + (isRecordingVisible ? TRACK_HEIGHT : 0)
            + expandedCount * TRACK_HEIGHT
            + collapsedCount * COLLAPSED_HEIGHT
            + (visibleCount > 0 ? (visibleCount - 1) * TRACK_GAP : 0)
            + TRACK_GAP * 2; // top + bottom padding

        return { tracks, totalHeight };
    }, [trackVisibility, hoveredTrack, hasCameraSource]);
}
