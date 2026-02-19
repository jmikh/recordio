import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { SpotlightSegment } from '../../../../types';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS, type TimelineSegmentDragState } from '../useTimelineSegmentDrag';
import { getValidBlockRange, doSourceRangesOverlap } from '../timelineTrackUtils';
import type { TimeMapper } from '../../../../core/mappers/timeMapper';

export interface HoverInfo {
    x: number; // Left position in pixels
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number; // Width in pixels
}

export function useSpotlightHover(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    dragState: TimelineSegmentDragState | null,
    editingSpotlightId: string | null,
    setEditingSpotlight: (id: string | null) => void,
    outputDuration: number,
    spotlightSegments: SpotlightSegment[],
    timeMapper: TimeMapper
) {
    const addSpotlight = useProjectStore(s => s.addSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const hoverInfoSetAtRef = useRef<number>(0);

    // Clear ghost whenever a spotlight is selected (covers the case where the
    // mouse didn't move after selection, so handleMouseMove never cleared it).
    useEffect(() => {
        if (editingSpotlightId) setHoverInfo(null);
    }, [editingSpotlightId]);

    /**
     * Handles hover interactions for 'Add Spotlight' ghost block.
     * Ghost sizing is tiered based on available gap vs transition duration:
     *   1. Full block (in + hold + out = K_DEFAULT_TIMELINE_BLOCK_MS) if it fits
     *   2. Transitions only (in + out = transitionMs × 2) if hold doesn't fit
     *   3. Fill the gap proportionally if not even both transitions fit
     *   4. No ghost if gap < K_MIN_TIMELINE_BLOCK_MS
     * DISABLED while dragging or when any zoom/spotlight is selected.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState || editingSpotlightId || selectedZoomId) {
            setHoverInfo(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const mouseTimeMs = coords.xToMs(x);

        if (mouseTimeMs > outputDuration || mouseTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        // Check if cursor is inside an existing spotlight
        const isInside = spotlightSegments.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
        );
        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // Smart placement: starts near cursor, expands right; anchors left if near a boundary
        const range = getValidBlockRange(
            mouseTimeMs,
            spotlightSegments,
            outputDuration,
            K_MIN_TIMELINE_BLOCK_MS,
            K_DEFAULT_TIMELINE_BLOCK_MS
        );

        if (!range) {
            setHoverInfo(null);
            return;
        }

        // Only stamp when ghost first appears (null → non-null)
        if (!hoverInfo) {
            hoverInfoSetAtRef.current = Date.now();
        }
        setHoverInfo({
            x: coords.msToX(range.start),
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width: coords.msToX(range.end - range.start),
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        const currentSelectedSpotlightId = useUIStore.getState().selectedSpotlightId;
        if (currentSelectedSpotlightId) {
            setEditingSpotlight(null);
            setHoverInfo(null);
            return;
        }

        // Require the ghost to have been visible for at least 200ms (prevents
        // accidental adds from mouse-jitter between rapid deselect clicks)
        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        // Get source video size for the initial rect (spotlight is in source coordinates)
        const sourceSize = project.screenSource.size;

        if (!sourceSize || sourceSize.width === 0) {
            console.warn('[useSpotlightHover] No sourceSize found');
            return;
        }

        // Convert output placement times → source times
        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Create initial rect centered at 50% of source video
        const { width, height } = sourceSize;
        const initialSourceRect = {
            width: width * 0.5,
            height: height * 0.5,
            x: width * 0.25,
            y: height * 0.25
        };

        const newSpotlight: SpotlightSegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            sourceRect: initialSourceRect,
            borderRadiusPx: [0, 0, 0, 0], // Start with sharp corners [tl, tr, br, bl]
            scale: project.settings.spotlight.enlargeScale,
            reason: 'Manual Spotlight'
        };

        // Delete any existing spotlights whose source range overlaps the new one
        const allSpotlights: SpotlightSegment[] = timeline.spotlightSegments || [];
        for (const existing of allSpotlights) {
            if (doSourceRangesOverlap(newSpotlight, existing)) {
                deleteSpotlight(existing.id);
            }
        }

        addSpotlight(newSpotlight);
        setEditingSpotlight(newSpotlight.id);
        setHoverInfo(null);
    };

    return {
        hoverInfo,
        handleMouseMove,
        handleMouseLeave,
        handleClick
    };
}
