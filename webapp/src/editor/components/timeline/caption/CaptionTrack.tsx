import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { CaptionBlock } from './CaptionBlock';
import { useCaptionDrag } from './useCaptionDrag';
import { useCaptionHover } from './useCaptionHover';
import { resolveOutputTimes, type OutputCaptionSegment } from '../timelineTrackUtils';
import { K_MIN_CAPTION_DURATION_MS } from './CaptionTrackUtils';
import { ghostCaption, CAPTION_BLOCK_HEIGHT } from './CaptionTrackStyles';

interface CaptionTrackProps {
    height: number;
}

/**
 * CaptionTrack renders caption segments on the timeline.
 *
 * Visual elements:
 * - Solid near-black blocks with primary border containing caption text
 * - Ghost "add caption" indicator on hover in empty gaps
 * - Resize handles on each block edge
 */
export const CaptionTrack: React.FC<CaptionTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const selectedCaptionId = useUIStore(s => s.selectedCaptionId);
    const selectCaption = useUIStore(s => s.selectCaption);
    const setCurrentTime = useUIStore(s => s.setCurrentTime);
    const setSettingsPanelActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);

    // Memoize TimeMapper and TimePixelMapper
    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    // Resolve captions from source time → output time
    const resolvedCaptions = useMemo(() => {
        const all = resolveOutputTimes(timeline.captionSegments || [], timeMapper) as OutputCaptionSegment[];
        return all.filter(r => (r.outputEndTimeMs - r.outputStartTimeMs) >= K_MIN_CAPTION_DURATION_MS);
    }, [timeline.captionSegments, timeMapper]);

    // Selection handler that also opens the captions settings tab
    const handleSelectCaption = (id: string | null) => {
        selectCaption(id);
        if (id) {
            setSettingsPanelActiveTab('captions');
        }
    };

    // Hooks
    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useCaptionDrag(
        timeline,
        coords,
        outputDuration,
        handleSelectCaption,
        resolvedCaptions,
        timeMapper
    );

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useCaptionHover(
        timeline,
        coords,
        dragState,
        selectedCaptionId,
        outputDuration,
        resolvedCaptions,
        timeMapper
    );

    const blockY = (height - CAPTION_BLOCK_HEIGHT) / 2;

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
                {/* Existing Captions (rendered using resolved output times) */}
                {resolvedCaptions.map((r) => {
                    const startX = coords.msToX(r.outputStartTimeMs);
                    const endX = coords.msToX(r.outputEndTimeMs);
                    const totalWidth = endX - startX;

                    if (totalWidth <= 0) return null;

                    const isSelected = selectedCaptionId === r.segment.id;
                    const isDragging = dragState?.captionId === r.segment.id;

                    return (
                        <CaptionBlock
                            key={r.segment.id}
                            left={startX}
                            width={totalWidth}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            text={r.segment.text || '[empty]'}
                            onMouseDown={(e) => handleDragStart(e, 'move', r.segment, isSelected)}
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
                                handleDragStart(e, 'resize-start', r.segment, isSelected);
                            }}
                            onResizeEndMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, 'resize-end', r.segment, isSelected);
                            }}
                        />
                    );
                })}

                {/* Add Caption Ghost Indicator */}
                {hoverInfo && !selectedCaptionId && !dragState && (
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
                            className={ghostCaption.block.className}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: blockY,
                                width: '100%',
                                ...ghostCaption.block.getStyle(),
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
