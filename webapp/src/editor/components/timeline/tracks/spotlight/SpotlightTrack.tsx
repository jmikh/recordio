import React, { useMemo } from 'react';
import { LuLightbulb } from 'react-icons/lu';
import { useProjectStore, useProjectTimeline } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { useTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../shared/useTimelineSegmentDrag';
import { useSpotlightHover } from './useSpotlightHover';
import { SpotlightBlock } from './SpotlightBlock';
import type { SpotlightSegment } from '@shared/types';

import {
    ghostSpotlight,
    ghostIconClass,
    MIN_ICON_WIDTH_PX,
} from '../shared/TimelineBlockStyles';
import { DisabledTrackOverlay } from '../shared/DisabledTrackOverlay';

interface SpotlightTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * SpotlightTrack renders spotlight effects on a timeline as single solid blocks.
 */
export const SpotlightTrack: React.FC<SpotlightTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const editingSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const setEditingSpotlight = (id: string | null) => {
        useUIStore.getState().selectSpotlight(id);
    };

    const project = useProjectStore(s => s.project);
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

    // Ghost vertical position — 1px padding
    const ghostY = 1;

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

                    return (
                        <SpotlightBlock
                            key={s.id}
                            left={startX}
                            width={totalWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            disabled={!spotlightEnabled}
                            isCollapsed={isCollapsed}
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

                        <div
                            className={`${ghostSpotlight.block.className} flex items-center justify-center overflow-hidden`}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: ghostY,
                                width: '100%',
                                ...ghostSpotlight.block.getStyle(),
                                height: height - 2,
                            }}
                        >
                            {hoverInfo.width >= MIN_ICON_WIDTH_PX && (
                                <LuLightbulb className={`${ghostIconClass} icon-md`} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
