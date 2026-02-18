import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useZoomDrag } from './useZoomDrag';
import { useZoomHover } from './useZoomHover';
import { calculateZoomScale, formatScaleLabel, prepareZoomActionsForUI } from './ZoomTrackUtils';
import {
    zoomBlock, blockLabel,
    ghostBlock,
    BLOCK_HEIGHT_FRACTION, BLOCK_BORDER_RADIUS, MIN_BLOCK_LABEL_WIDTH_PX,
} from './ZoomTrackStyles';
import type { ZoomAction } from '../../../../types';

interface ZoomTrackProps {
    height: number;
}

/**
 * ZoomTrack renders zoom actions as time-range blocks on the timeline.
 *
 * Each block spans [outputStartTime, outputEndTime] and shows the zoom scale.
 */
export const ZoomTrack: React.FC<ZoomTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const editingZoomId = useUIStore(s => s.selectedZoomId);
    const setEditingZoom = (id: string | null) => {
        const store = useUIStore.getState();
        store.selectZoom(id);
    };

    const project = useProjectStore(s => s.project);
    const outputSize = project.settings.outputSize;
    const zoomSettings = project.settings.zoom;

    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    const preparedActions = useMemo(() => {
        return prepareZoomActionsForUI(
            timeline.zoomActions || [],
            timeMapper,
            zoomSettings
        );
    }, [timeline.zoomActions, timeMapper, zoomSettings]);

    // ------------------------------------------------------------------
    // HOOKS (DRAG & HOVER)
    // ------------------------------------------------------------------

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useZoomDrag(
        timeline,
        project,
        coords,
        outputDuration,
        setEditingZoom,
        preparedActions
    );

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useZoomHover(
        timeline,
        project,
        coords,
        dragState,
        editingZoomId,
        setEditingZoom,
        outputDuration,
        preparedActions
    );

    // ------------------------------------------------------------------
    // BLOCK HEIGHT
    // ------------------------------------------------------------------

    const blockHeight = Math.round(height * BLOCK_HEIGHT_FRACTION);

    // ------------------------------------------------------------------
    // RENDER BLOCKS
    // ------------------------------------------------------------------

    const renderBlocks = useMemo(() => {
        const elements: React.ReactNode[] = [];

        const sortedActions = [...preparedActions].sort((a, b) => a.outputStartTime - b.outputStartTime);

        sortedActions.forEach((action) => {
            const startX = coords.msToX(action.outputStartTime);
            const endX = coords.msToX(action.outputEndTime);
            const blockWidth = Math.max(endX - startX, 2);

            const isSelected = editingZoomId === action.id;
            const isDragging = dragState?.motionId === action.id;
            const scale = calculateZoomScale(action.rectPx, outputSize);
            const showLabel = blockWidth >= MIN_BLOCK_LABEL_WIDTH_PX;

            const originalAction = timeline.zoomActions.find((a: ZoomAction) => a.id === action.id);
            if (!originalAction) return;

            const blockClass = [
                zoomBlock.base,
                isSelected ? zoomBlock.selected : zoomBlock.default,
                isDragging ? zoomBlock.dragging : '',
            ].join(' ');

            elements.push(
                <div
                    key={`block-${action.id}`}
                    className={blockClass}
                    style={{
                        left: `${startX}px`,
                        width: `${blockWidth}px`,
                        height: `${blockHeight}px`,
                        borderRadius: BLOCK_BORDER_RADIUS,
                    }}
                    onMouseDown={(e) => handleDragStart(e, 'move', originalAction, isSelected)}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (wasDraggingRef.current) {
                            wasDraggingRef.current = false;
                            return;
                        }
                        if (wasSelectedBeforeMousedownRef.current) {
                            setEditingZoom(null);
                        }
                    }}
                >
                    {showLabel && (
                        <span className={blockLabel.className}>
                            {formatScaleLabel(scale)}
                        </span>
                    )}
                </div>
            );
        });

        return elements;
    }, [preparedActions, coords, outputSize, editingZoomId, dragState, blockHeight, handleDragStart, timeline.zoomActions]);

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

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

                {/* Zoom blocks */}
                {renderBlocks}

                {/* Ghost block — shown when hovering to add a new zoom */}
                {hoverInfo && !editingZoomId && !dragState && (
                    <div
                        className={ghostBlock.className}
                        style={{
                            left: `${hoverInfo.x - hoverInfo.width}px`,
                            width: `${hoverInfo.width}px`,
                            height: `${blockHeight}px`,
                            borderRadius: BLOCK_BORDER_RADIUS,
                        }}
                    >
                        <span className={ghostBlock.label}>+ Zoom</span>
                    </div>
                )}
            </div>
        </div>
    );
};
