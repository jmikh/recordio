import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useZoomDrag } from './useZoomDrag';
import { useZoomHover } from './useZoomHover';
import { ZoomKeyframe } from './ZoomKeyframe';
import { TransitionTrail, HoldLine } from './ZoomLines';
import { calculateZoomScale, formatScaleLabel, isFullViewport, prepareZoomActionsForUI } from './ZoomTrackUtils';
import { ghostKeyframe, ghostTrail } from './ZoomTrackStyles';
import type { ZoomAction } from '../../../../types';

interface ZoomTrackProps {
    height: number;
}

/**
 * ZoomTrack renders keyframed zoom/pan transitions on a timeline.
 * 
 * Visual elements:
 * - Diamond keyframes for zoomed states
 * - Hollow square keyframes for full-viewport (1x) states
 * - Transition trails (thick lines) leading into keyframes
 * - Hold lines (semi-transparent) between zoomed keyframes
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

    // Memoize TimeMapper and TimePixelMapper for consistent usage
    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    // Derive output duration from output windows
    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    // Prepare zoom actions with computed output times and durations
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
    // COMPUTE LINE SEGMENTS AND KEYFRAMES
    // ------------------------------------------------------------------

    // Minimum pixel distance between keyframes before hiding all labels
    const MIN_LABEL_DISTANCE_PX = 30;

    const renderElements = useMemo(() => {
        const elements: React.ReactNode[] = [];

        // Sort prepared actions by output end time for proper sequencing
        const sortedActions = [...preparedActions].sort((a, b) => a.outputEndTime - b.outputEndTime);

        // Calculate if any consecutive keyframes are too close
        let hideLabels = false;
        for (let i = 0; i < sortedActions.length - 1; i++) {
            const currentX = coords.msToX(sortedActions[i].outputEndTime);
            const nextX = coords.msToX(sortedActions[i + 1].outputEndTime);
            if (nextX - currentX < MIN_LABEL_DISTANCE_PX) {
                hideLabels = true;
                break;
            }
        }

        sortedActions.forEach((action, index) => {
            const keyframeX = coords.msToX(action.outputEndTime);
            const trailWidth = coords.msToX(action.duration);
            const trailStartX = keyframeX - trailWidth;
            const isFullScreen = isFullViewport(action.rectPx, outputSize);
            const isSelected = editingZoomId === action.id;
            const isDragging = dragState?.motionId === action.id;
            const scale = calculateZoomScale(action.rectPx, outputSize);

            // 1. Render transition trail leading into this keyframe
            elements.push(
                <TransitionTrail
                    key={`trail-${action.id}`}
                    left={trailStartX}
                    width={trailWidth}
                    isSelected={isSelected}
                />
            );

            // 2. Render hold line or no-zoom line extending from this keyframe
            // to the next action's trail start (or end of timeline)
            const nextAction = sortedActions[index + 1];
            const nextTrailStartMs = nextAction
                ? nextAction.outputStartTime
                : outputDuration;

            const lineStartX = keyframeX;
            const lineEndX = coords.msToX(nextTrailStartMs);
            const lineWidth = lineEndX - lineStartX;

            if (lineWidth > 0) {
                if (!isFullScreen) {
                    // Zoom holds steady between keyframes
                    elements.push(
                        <HoldLine
                            key={`hold-${action.id}`}
                            left={lineStartX}
                            width={lineWidth}
                            isSelected={isSelected}
                        />
                    );
                }
            }

            // 3. Render keyframe marker - need to find original action for handleDragStart
            const originalAction = timeline.zoomActions.find((a: ZoomAction) => a.id === action.id);
            if (!originalAction) return;

            elements.push(
                <ZoomKeyframe
                    key={`keyframe-${action.id}`}
                    left={keyframeX}
                    isFullViewport={isFullScreen}
                    scaleLabel={formatScaleLabel(scale)}
                    isSelected={isSelected}
                    isDragging={isDragging}
                    hideLabel={hideLabels}
                    onMouseDown={(e) => handleDragStart(e, 'move', originalAction, isSelected)}
                    onClick={(e) => {
                        e.stopPropagation();
                        // Suppress toggle if we just finished dragging
                        if (wasDraggingRef.current) {
                            wasDraggingRef.current = false;
                            return;
                        }
                        // Toggle: only deselect if it was already selected before mousedown
                        if (wasSelectedBeforeMousedownRef.current) {
                            setEditingZoom(null);
                        }
                    }}
                />
            );
        });

        return elements;
    }, [preparedActions, coords, outputSize, editingZoomId, dragState, outputDuration, handleDragStart, timeline.zoomActions]);

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

                {/* Line segments and keyframes */}
                {renderElements}

                {/* Add Zoom Ghost Indicator */}
                {hoverInfo && !editingZoomId && !dragState && (
                    <>
                        {/* Ghost transition trail */}
                        <div
                            className={ghostTrail.className}
                            style={{
                                left: `${hoverInfo.x - hoverInfo.width}px`,
                                width: `${hoverInfo.width}px`,
                                height: ghostTrail.height,
                                opacity: ghostTrail.opacity,
                            }}
                        />
                        {/* Ghost keyframe diamond */}
                        <div
                            className={ghostKeyframe.container}
                            style={{ left: `${hoverInfo.x}px` }}
                        >
                            <span className={ghostKeyframe.label}>
                                + Zoom
                            </span>
                            <div
                                className={ghostKeyframe.diamond}
                                style={ghostKeyframe.diamondStyle}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
