import React, { useMemo } from 'react';
import { RiLightbulbFlashLine } from 'react-icons/ri';
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
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';
import { DisabledTrackOverlay } from '../DisabledTrackOverlay';

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
    const globalTransitionDurationMs = project.settings.spotlight.transitionDurationMs;
    const spotlightEnabled = project.settings.spotlight.enabled ?? true;

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

    // Ghost fade width uses global transition duration
    const ghostFadeWidthPx = coords.msToX(globalTransitionDurationMs);

    // Calculate vertical positions for ghost
    const fadeY = (height - FADE_HEIGHT) / 2;
    const holdY = (height - HOLD_HEIGHT) / 2;

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={spotlightEnabled ? handleMouseMove : undefined}
            onMouseLeave={spotlightEnabled ? handleMouseLeave : undefined}
            onPointerDown={spotlightEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={spotlightEnabled ? handleClick : undefined}
            title={!spotlightEnabled ? 'Enable spotlights to interact' : undefined}
        >
            {/* Content Area */}
            <div className="relative flex-1" style={{ height }}>
                {!spotlightEnabled && <DisabledTrackOverlay height={height} />}
                {/* Existing Spotlights */}
                {spotlightSegments.map((s) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const totalWidth = endX - startX;

                    if (totalWidth <= 0) return null;

                    const isSelected = editingSpotlightId === s.id;
                    const isDragging = dragState?.segmentId === s.id;

                    // Per-segment fade width from segment's transitionDurationMs
                    const segFadeWidthPx = coords.msToX(s.transitionDurationMs ?? globalTransitionDurationMs);
                    const clampedFadeWidthPx = Math.min(segFadeWidthPx, totalWidth / 2);

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
                            disabled={!spotlightEnabled}
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
                {spotlightEnabled && hoverInfo && !editingSpotlightId && !dragState && (
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
                                width: Math.min(hoverInfo.width / 2, ghostFadeWidthPx),
                                ...ghostSpotlight.fadeIn.getStyle(),
                            }}
                        />

                        {/* Ghost Hold (may be 0 width when ghost is short) */}
                        {(() => {
                            const ghostHoldWidth = Math.max(0, hoverInfo.width - Math.min(hoverInfo.width / 2, ghostFadeWidthPx) * 2);
                            return ghostHoldWidth > 0 && (
                                <div
                                    className={`${ghostSpotlight.hold.className} flex items-center justify-center overflow-hidden`}
                                    style={{
                                        position: 'absolute',
                                        left: Math.min(hoverInfo.width / 2, ghostFadeWidthPx),
                                        top: holdY,
                                        width: ghostHoldWidth,
                                        ...ghostSpotlight.hold.getStyle(),
                                    }}
                                >
                                    {ghostHoldWidth >= MIN_ICON_WIDTH_PX && (
                                        <RiLightbulbFlashLine className={blockIconClass} size={BLOCK_ICON_SIZE} />
                                    )}
                                </div>
                            );
                        })()}

                        {/* Ghost Fade Out */}
                        <div
                            className={ghostSpotlight.fadeOut.className}
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: fadeY,
                                width: Math.min(hoverInfo.width / 2, ghostFadeWidthPx),
                                ...ghostSpotlight.fadeOut.getStyle(),
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
