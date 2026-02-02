import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useZoomDrag } from './useZoomDrag';
import { useZoomHover } from './useZoomHover';
import { ZoomKeyframe } from './ZoomKeyframe';
import { TransitionTrail, HoldLine } from './ZoomLines';
import { calculateZoomScale, formatScaleLabel, isFullViewport } from './ZoomTrackUtils';
import { ghostKeyframe, ghostTrail } from './ZoomTrackStyles';
import type { ZoomAction } from '../../../../core/types';

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

    // Memoize TimeMapper and TimePixelMapper for consistent usage
    const timeMapper = useTimeMapper();

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    // Derive output duration from output windows
    const outputDuration = useMemo(() => {
        return timeMapper.getOutputDuration();
    }, [timeMapper]);

    // ------------------------------------------------------------------
    // HOOKS (DRAG & HOVER)
    // ------------------------------------------------------------------

    const { dragState, handleDragStart, wasDraggingRef } = useZoomDrag(
        timeline,
        project,
        coords,
        outputDuration
    );

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useZoomHover(
        timeline,
        project,
        coords,
        dragState,
        editingZoomId,
        setEditingZoom,
        outputDuration
    );

    // ------------------------------------------------------------------
    // COMPUTE LINE SEGMENTS AND KEYFRAMES
    // ------------------------------------------------------------------

    // Minimum pixel distance between keyframes before hiding all labels
    const MIN_LABEL_DISTANCE_PX = 40;

    const renderElements = useMemo(() => {
        const actions: ZoomAction[] = timeline.zoomActions || [];
        const elements: React.ReactNode[] = [];

        // Sort actions by output end time for proper sequencing
        const sortedActions = [...actions].sort((a, b) => a.outputEndTimeMs - b.outputEndTimeMs);

        // Calculate if any consecutive keyframes are too close
        let hideLabels = false;
        for (let i = 0; i < sortedActions.length - 1; i++) {
            const currentX = coords.msToX(sortedActions[i].outputEndTimeMs);
            const nextX = coords.msToX(sortedActions[i + 1].outputEndTimeMs);
            if (nextX - currentX < MIN_LABEL_DISTANCE_PX) {
                hideLabels = true;
                break;
            }
        }

        sortedActions.forEach((action, index) => {
            const keyframeX = coords.msToX(action.outputEndTimeMs);
            const trailWidth = coords.msToX(action.durationMs);
            const trailStartX = keyframeX - trailWidth;
            const isFullScreen = isFullViewport(action.rect, outputSize);
            const isSelected = editingZoomId === action.id;
            const isDragging = dragState?.motionId === action.id;
            const scale = calculateZoomScale(action.rect, outputSize);

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
                ? nextAction.outputEndTimeMs - nextAction.durationMs
                : outputDuration;

            const lineStartX = keyframeX;
            const lineEndX = coords.msToX(nextTrailStartMs);
            const lineWidth = lineEndX - lineStartX;

            if (lineWidth > 0) {
                if (!isFullScreen) {
                    // Zoom holds steady between keyframes
                    // (No line rendered after full-viewport keyframes)
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

            // 3. Render keyframe marker
            elements.push(
                <ZoomKeyframe
                    key={`keyframe-${action.id}`}
                    left={keyframeX}
                    isFullViewport={isFullScreen}
                    scaleLabel={formatScaleLabel(scale)}
                    isSelected={isSelected}
                    isDragging={isDragging}
                    hideLabel={hideLabels}
                    onMouseDown={(e) => handleDragStart(e, 'move', action)}
                    onClick={(e) => {
                        e.stopPropagation();
                        // Suppress toggle if we just finished dragging
                        if (wasDraggingRef.current) {
                            wasDraggingRef.current = false;
                            return;
                        }
                        // Toggle: if already selected, deselect; otherwise select
                        setEditingZoom(editingZoomId === action.id ? null : action.id);
                    }}
                />
            );
        });

        return elements;
    }, [timeline.zoomActions, coords, outputSize, editingZoomId, dragState, outputDuration, handleDragStart]);

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    return (
        <div
            className="w-full relative bg-surface-elevated select-none flex"
            style={{ height }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleClick}
        >
            {/* Content Area */}
            <div className="relative flex-1" style={{ height }}>
                {/* Full-width track background bar */}
                <div
                    className="absolute top-[6px] bottom-[6px] left-0 right-0 bg-surface-overlay rounded-sm"
                    style={{ zIndex: 1 }}
                />

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
