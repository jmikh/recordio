import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../useTimelineSegmentDrag';
import { useSpotlightHover } from './useSpotlightHover';
import { SpotlightBlock } from './SpotlightBlock';
import type { SpotlightSegment } from '../../../../types';

import {
    ghostSpotlight,
    FADE_HEIGHT,
    HOLD_HEIGHT
} from './SpotlightTrackStyles';

interface SpotlightTrackProps {
    height: number;
}

/**
 * SpotlightTrack renders spotlight effects on a timeline.
 * 
 * Visual elements:
 * - Fade In segment (shorter, striped, 45° angle)
 * - Hold segment (taller, solid fill)
 * - Fade Out segment (shorter, striped, -45° angle)
 */
export const SpotlightTrack: React.FC<SpotlightTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const editingSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const setEditingSpotlight = (id: string | null) => {
        useUIStore.getState().selectSpotlight(id);
    };

    const project = useProjectStore(s => s.project);
    const transitionDurationMs = project.settings.spotlight.transitionDurationMs;

    // Memoize TimeMapper and TimePixelMapper
    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    // Only filter out non-visible segments (cut windows); no duration gate
    const spotlightSegments = useMemo(() =>
        (timeline.spotlightSegments || []).filter((s: SpotlightSegment) => s.visible)
        , [timeline.spotlightSegments]);

    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);

    // Hooks
    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<SpotlightSegment>({
        segments: spotlightSegments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setEditingSpotlight,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateSpotlight(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteSpotlight,
        getAllSegments: () => timeline.spotlightSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useSpotlightHover(
        timeline,
        project,
        coords,
        dragState,
        editingSpotlightId,
        setEditingSpotlight,
        outputDuration,
        spotlightSegments,
        timeMapper
    );

    // Fade width = min(half of ghost width, full transition time) — hold is the remainder (may be 0)
    const fadeWidthPx = coords.msToX(transitionDurationMs);

    // Calculate vertical positions for ghost
    const fadeY = (height - FADE_HEIGHT) / 2;
    const holdY = (height - HOLD_HEIGHT) / 2;

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClick}
        >
            {/* Content Area */}
            <div className="relative flex-1" style={{ height }}>
                {/* Existing Spotlights */}
                {spotlightSegments.map((s) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const totalWidth = endX - startX;

                    if (totalWidth <= 0) return null;

                    const isSelected = editingSpotlightId === s.id;
                    const isDragging = dragState?.segmentId === s.id;

                    // Cap fade widths so they never exceed half the block width (handles min-width edge case)
                    const clampedFadeWidthPx = Math.min(fadeWidthPx, totalWidth / 2);

                    return (
                        <SpotlightBlock
                            key={s.id}
                            left={startX}
                            width={totalWidth}
                            fadeInWidth={clampedFadeWidthPx}
                            fadeOutWidth={clampedFadeWidthPx}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            onMouseDown={(e) => handleDragStart(e, 'move', s, isSelected)}
                            onClick={(e) => {
                                e.stopPropagation();
                                // Suppress toggle if we just finished dragging
                                if (wasDraggingRef.current) {
                                    wasDraggingRef.current = false;
                                    return;
                                }
                                // Toggle: only deselect if it was already selected before mousedown
                                // If it wasn't selected, mousedown already selected it, so do nothing
                                if (wasSelectedBeforeMousedownRef.current) {
                                    setEditingSpotlight(null);
                                } else {
                                    // First click - CTI already moved on mousedown via drag handler
                                }
                            }}
                            onResizeStartMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-start', s, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', s, isSelected);
                            }}
                        />
                    );
                })}

                {/* Add Spotlight Ghost Indicator */}
                {hoverInfo && !editingSpotlightId && !dragState && (
                    <div
                        className={ghostSpotlight.container}
                        style={{
                            left: `${hoverInfo.x}px`,
                            width: `${hoverInfo.width}px`,
                            height,
                        }}
                    >
                        {/* Label above the ghost */}
                        <span className={ghostSpotlight.label}>+ Spotlight</span>

                        {/* Ghost Fade In */}
                        <div
                            className={ghostSpotlight.fadeIn.className}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: fadeY,
                                width: Math.min(hoverInfo.width / 2, fadeWidthPx),
                                ...ghostSpotlight.fadeIn.getStyle(),
                            }}
                        />

                        {/* Ghost Hold (may be 0 width when ghost is short) */}
                        <div
                            className={ghostSpotlight.hold.className}
                            style={{
                                position: 'absolute',
                                left: Math.min(hoverInfo.width / 2, fadeWidthPx),
                                top: holdY,
                                width: Math.max(0, hoverInfo.width - Math.min(hoverInfo.width / 2, fadeWidthPx) * 2),
                                ...ghostSpotlight.hold.getStyle(),
                            }}
                        />

                        {/* Ghost Fade Out */}
                        <div
                            className={ghostSpotlight.fadeOut.className}
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: fadeY,
                                width: Math.min(hoverInfo.width / 2, fadeWidthPx),
                                ...ghostSpotlight.fadeOut.getStyle(),
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
