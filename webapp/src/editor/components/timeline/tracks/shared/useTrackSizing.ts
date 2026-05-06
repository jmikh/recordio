import { useMemo } from 'react';
import { useUIStore } from '../../../../stores/useUIStore';
import { useProjectStore } from '../../../../stores/useProjectStore';
import type { DisplaySettings } from '@shared/types/timeline';

// ============================================================================
// TRACK SIZING HOOK
// Computes per-track heights for the hover-to-expand timeline system.
//
// Rules:
// 1. Recording is ALWAYS full height — never collapses, not part of DisplaySettings
// 2. When no track is hovered → the first visible non-recording track is full height
// 3. When a track is hovered → that track becomes full height
// 4. All other non-recording tracks collapse to COLLAPSED_HEIGHT
// ============================================================================

/** Full track height (same as existing TRACK_HEIGHT) */
export const TRACK_HEIGHT = 32;

/** Collapsed track height (~40% of full) */
export const COLLAPSED_HEIGHT = 13;

type EffectTrack = 'zoom' | 'spotlight' | 'cameraMove' | 'overlay';

/** Track ordering for effect tracks (recording is handled separately) */
const EFFECT_TRACK_ORDER: EffectTrack[] = [
    'zoom',
    'spotlight',
    'cameraMove',
    'overlay',
];

/** Maps effect track keys to their DisplaySettings show_ field */
const SHOW_KEY: Record<EffectTrack, keyof DisplaySettings> = {
    zoom: 'showZoom',
    spotlight: 'showSpotlight',
    cameraMove: 'showCameraMove',
    overlay: 'showOverlay',
};

/** Gap between track rows */
export const TRACK_GAP = 4;

/** Ruler height (24px canvas + 2px borders) */
const RULER_HEIGHT = 26;

export interface TrackSizeInfo {
    height: number;
    isCollapsed: boolean;
}

export interface TrackSizingResult {
    tracks: Record<EffectTrack, TrackSizeInfo>;
    /** Recording track is always full height */
    recordingHeight: number;
    /** Deterministic total height for all visible tracks including gaps and padding */
    totalHeight: number;
}

export function useTrackSizing(): TrackSizingResult {
    const displaySettings = useProjectStore(s => s.project.timeline.displaySettings) ?? {
        showZoom: true, showSpotlight: true, showCameraMove: true, showOverlay: true, collapsed: false,
    };
    const hoveredTrack = useUIStore(s => s.hoveredTrack);
    const hasCameraSource = useProjectStore(s => !!s.project.cameraSource);

    return useMemo(() => {
        // Determine which effect tracks are actually visible
        const visibleEffects = EFFECT_TRACK_ORDER.filter(key => {
            if (key === 'cameraMove' && !hasCameraSource) return false;
            return displaySettings[SHOW_KEY[key]];
        });

        const tracks = {} as Record<EffectTrack, TrackSizeInfo>;

        if (!displaySettings.collapsed) {
            // All visible tracks at full height (no hover-to-expand)
            for (const key of EFFECT_TRACK_ORDER) {
                tracks[key] = { height: TRACK_HEIGHT, isCollapsed: false };
            }

            // Recording + visible effect tracks
            const visibleCount = 1 + visibleEffects.length;
            const totalHeight = RULER_HEIGHT
                + visibleCount * TRACK_HEIGHT
                + (visibleCount > 0 ? (visibleCount - 1) * TRACK_GAP : 0)
                + TRACK_GAP * 2;

            return { tracks, recordingHeight: TRACK_HEIGHT, totalHeight };
        }

        // Hover-to-expand mode: one expanded + rest collapsed
        const defaultExpanded = visibleEffects[0] ?? null;
        const expandedTrack = hoveredTrack && displaySettings[SHOW_KEY[hoveredTrack as EffectTrack]]
            ? hoveredTrack
            : defaultExpanded;

        for (const key of EFFECT_TRACK_ORDER) {
            if (key === expandedTrack) {
                tracks[key] = { height: TRACK_HEIGHT, isCollapsed: false };
            } else {
                tracks[key] = { height: COLLAPSED_HEIGHT, isCollapsed: true };
            }
        }

        // Recording always full + effect tracks
        const visibleCount = 1 + visibleEffects.length;
        const collapsedCount = Math.max(0, visibleEffects.length - 1);
        const expandedCount = visibleEffects.length > 0 ? 1 : 0;
        const totalHeight = RULER_HEIGHT
            + TRACK_HEIGHT  // recording
            + expandedCount * TRACK_HEIGHT
            + collapsedCount * COLLAPSED_HEIGHT
            + (visibleCount > 0 ? (visibleCount - 1) * TRACK_GAP : 0)
            + TRACK_GAP * 2;

        return { tracks, recordingHeight: TRACK_HEIGHT, totalHeight };
    }, [displaySettings, hoveredTrack, hasCameraSource]);
}
