import React, { useMemo } from 'react';
import { FaRegClosedCaptioning } from 'react-icons/fa';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { CaptionBlock } from './CaptionBlock';
import { useTimelineSegmentDrag } from '../useTimelineSegmentDrag';
import { useCaptionHover } from './useCaptionHover';
import type { CaptionSegment } from '../../../../types';
import { K_MIN_CAPTION_DURATION_MS } from './CaptionTrackUtils';
import { ghostCaption } from './CaptionTrackStyles';
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';
import { DisabledTrackOverlay } from '../DisabledTrackOverlay';

interface CaptionTrackProps {
    height: number;
    isCollapsed?: boolean;
}

/**
 * CaptionTrack renders caption segments on the timeline.
 *
 * Visual elements:
 * - Solid near-black blocks with primary border containing caption text
 * - Ghost "add caption" indicator on hover in empty gaps
 * - Resize handles on each block edge
 */
export const CaptionTrack: React.FC<CaptionTrackProps> = ({ height, isCollapsed }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const selectedCaptionId = useUIStore(s => s.selectedCaptionId);
    const selectCaption = useUIStore(s => s.selectCaption);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setSettingsPanelActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);

    const captionsEnabled = useProjectStore(s => s.project.settings.captions.enabled ?? true);

    // Memoize TimeMapper and TimePixelMapper
    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    // Filter captions: visible and above min duration
    const captionSegments = useMemo(() => {
        return (timeline.captionSegments || []).filter((s: CaptionSegment) =>
            s.visible && (s.outputEndTimeMs - s.outputStartTimeMs) >= K_MIN_CAPTION_DURATION_MS
        );
    }, [timeline.captionSegments]);

    // Selection handler that also opens the captions settings tab
    const handleSelectCaption = (id: string | null) => {
        selectCaption(id);
        if (id) {
            setSettingsPanelActiveTab('captions');
        }
    };

    const updateCaptionSegment = useProjectStore(s => s.updateCaptionSegment);
    const deleteCaptionSegment = useProjectStore(s => s.deleteCaptionSegment);

    // Hooks
    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<CaptionSegment>({
        segments: captionSegments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: handleSelectCaption,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateCaptionSegment(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteCaptionSegment,
        getAllSegments: () => timeline.captionSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useCaptionHover(
        timeline,
        coords,
        dragState,
        selectedCaptionId,
        outputDuration,
        captionSegments,
        timeMapper
    );

    const blockY = 1;

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={captionsEnabled ? handleMouseMove : undefined}
            onMouseLeave={captionsEnabled ? handleMouseLeave : undefined}
            onPointerDown={captionsEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={captionsEnabled ? handleClick : undefined}
            title={!captionsEnabled ? 'Enable captions to interact' : undefined}
        >
            {/* Content Area */}
            <div className="relative flex-1" style={{ height }}>
                {!captionsEnabled && <DisabledTrackOverlay height={height} />}
                {/* Existing Captions */}
                {captionSegments.map((s) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const totalWidth = endX - startX;

                    if (totalWidth <= 0) return null;

                    const isSelected = selectedCaptionId === s.id;
                    const isDragging = dragState?.segmentId === s.id;

                    return (
                        <CaptionBlock
                            key={s.id}
                            left={startX}
                            width={totalWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            text={s.text || '[empty]'}
                            disabled={!captionsEnabled}
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
                                if (wasSelectedBeforeMousedownRef.current) {
                                    handleSelectCaption(null);
                                } else {
                                    // First click - CTI already moved on mousedown via drag handler
                                    // Open captions settings panel
                                    setSettingsPanelActiveTab('captions');
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

                {/* Add Caption Ghost Indicator */}
                {captionsEnabled && hoverInfo && !selectedCaptionId && !dragState && (
                    <div
                        className={ghostCaption.container}
                        style={{
                            left: `${hoverInfo.x}px`,
                            width: `${hoverInfo.width}px`,
                            height,
                        }}
                    >
                        {/* Label above the ghost */}
                        <span className={ghostCaption.label}>+ Caption</span>

                        {/* Ghost block */}
                        <div
                            className={`${ghostCaption.block.className} flex items-center justify-center overflow-hidden`}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: blockY,
                                width: '100%',
                                ...ghostCaption.block.getStyle(),
                            }}
                        >
                            {hoverInfo.width >= MIN_ICON_WIDTH_PX && (
                                <FaRegClosedCaptioning className={blockIconClass} size={BLOCK_ICON_SIZE} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
