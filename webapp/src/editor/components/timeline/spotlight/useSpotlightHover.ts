import { useState } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { SpotlightSegment, SpotlightSettings } from '../../../../types';
import type { DragState } from './useSpotlightDrag';
import type { ResolvedSpotlight } from './SpotlightTrackUtils';
import { getValidSpotlightRange, getMinSpotlightDuration, getDefaultSpotlightDuration, doSourceRangesOverlap } from './SpotlightTrackUtils';
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
    dragState: DragState | null,
    editingSpotlightId: string | null,
    setEditingSpotlight: (id: string | null) => void,
    outputDuration: number,
    resolvedSpotlights: ResolvedSpotlight[],
    timeMapper: TimeMapper
) {
    const addSpotlight = useProjectStore(s => s.addSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

    const settings: SpotlightSettings = project.settings.spotlight;
    const defaultDuration = getDefaultSpotlightDuration(settings);

    /**
     * Handles hover interactions for 'Add Spotlight' ghost block.
     * Spotlight starts at mouse position and extends to the right.
     * DISABLED while dragging to prevent interference.
     * DISABLED when any zoom or spotlight is selected.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        // No ghost when dragging or when something is selected
        if (dragState || editingSpotlightId || selectedZoomId) {
            setHoverInfo(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;

        const mouseTimeMs = coords.xToMs(x);

        // Don't show hover if we're past the end of the output
        if (mouseTimeMs > outputDuration || mouseTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        // Check if we are inside an existing (visible) spotlight
        const isInside = resolvedSpotlights.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
        );

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // Find valid range for new spotlight (starts at mouse position, using resolved output times)
        const range = getValidSpotlightRange(
            mouseTimeMs,
            resolvedSpotlights,
            outputDuration,
            getMinSpotlightDuration(settings.transitionDurationMs),
            defaultDuration
        );

        // Don't show ghost if no valid range (not enough space)
        if (!range) {
            setHoverInfo(null);
            return;
        }

        const width = coords.msToX(range.end - range.start);
        const leftX = coords.msToX(range.start);

        setHoverInfo({
            x: leftX,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width,
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        if (editingSpotlightId) {
            setEditingSpotlight(null);
            return;
        }

        if (!hoverInfo) return;

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
