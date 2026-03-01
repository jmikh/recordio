import React, { useMemo } from 'react';
import { PiWebcamBold } from 'react-icons/pi';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useTimelineSegmentDrag } from '../useTimelineSegmentDrag';
import { useCameraLayoutHover } from './useCameraLayoutHover';
import { CameraLayoutBlock } from './CameraLayoutBlock';
import {
    ghostCameraLayout,
    HOLD_HEIGHT,
    SEGMENT_RADIUS,
} from './CameraLayoutTrackStyles';
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';
import { DisabledTrackOverlay } from '../DisabledTrackOverlay';
import type { CameraLayoutSegment } from '../../../../types';

interface CameraLayoutTrackProps {
    height: number;
}

/**
 * CameraLayoutTrack renders camera layout segments as time-range blocks.
 * Follows the same visual pattern as ZoomTrack: transition-in zone + hold zone.
 */
export const CameraLayoutTrack: React.FC<CameraLayoutTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    const selectedId = useUIStore(s => s.selectedCameraLayoutId);
    const setSelected = (id: string | null) => {
        useUIStore.getState().selectCameraLayout(id);
    };

    const project = useProjectStore(s => s.project);
    const globalTransitionDurationMs = project.settings.cameraLayout?.transitionDurationMs ?? 500;
    const cameraLayoutEnabled = project.settings.cameraLayout?.enabled ?? true;

    const timeMapper = useTimeMapper();
    const coords = useMemo(() => new TimePixelMapper(timeMapper, pixelsPerSec), [timeMapper, pixelsPerSec]);
    const outputDuration = useMemo(() => timeMapper.getOutputDuration(), [timeMapper]);

    const segments = useMemo(() =>
        (timeline.cameraLayoutSegments || []).filter((s: CameraLayoutSegment) => s.visible),
        [timeline.cameraLayoutSegments]);

    const ghostY = (height - HOLD_HEIGHT) / 2;

    const updateCameraLayout = useProjectStore(s => s.updateCameraLayout);
    const deleteCameraLayout = useProjectStore(s => s.deleteCameraLayout);

    const { dragState, handleDragStart, wasDraggingRef, wasSelectedBeforeMousedownRef } = useTimelineSegmentDrag<CameraLayoutSegment>({
        segments,
        outputDuration,
        coords,
        timeMapper,
        onSelect: setSelected,
        onUpdate: (id, sourceStart, sourceEnd) =>
            updateCameraLayout(id, { sourceStartTimeMs: sourceStart, sourceEndTimeMs: sourceEnd }),
        onDelete: deleteCameraLayout,
        getAllSegments: () => timeline.cameraLayoutSegments ?? [],
    });

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useCameraLayoutHover(
        project,
        coords,
        dragState,
        selectedId,
        setSelected,
        outputDuration,
        segments,
        timeMapper
    );

    return (
        <div
            className="w-full relative select-none flex"
            style={{ height }}
            onMouseMove={cameraLayoutEnabled ? handleMouseMove : undefined}
            onMouseLeave={cameraLayoutEnabled ? handleMouseLeave : undefined}
            onPointerDown={cameraLayoutEnabled ? (e) => e.stopPropagation() : undefined}
            onClick={cameraLayoutEnabled ? handleClick : undefined}
            title={!cameraLayoutEnabled ? 'Enable layouts to interact' : undefined}
        >
            <div className="relative flex-1" style={{ height }}>
                {!cameraLayoutEnabled && <DisabledTrackOverlay height={height} />}
                {/* Camera layout blocks */}
                {segments.map((s: CameraLayoutSegment) => {
                    const startX = coords.msToX(s.outputStartTimeMs);
                    const endX = coords.msToX(s.outputEndTimeMs);
                    const blockWidth = Math.max(endX - startX, 2);

                    if (blockWidth <= 0) return null;

                    const isSelected = selectedId === s.id;
                    const isDragging = dragState?.segmentId === s.id;
                    const segTransitionWidthPx = coords.msToX(s.transitionDurationMs ?? globalTransitionDurationMs);

                    return (
                        <CameraLayoutBlock
                            key={s.id}
                            left={startX}
                            width={blockWidth}
                            transitionInWidth={segTransitionWidthPx}
                            transitionOutWidth={segTransitionWidthPx}
                            isSelected={isSelected}
                            isDragging={isDragging}
                            trackHeight={height}
                            isHidden={s.hidden}
                            disabled={!cameraLayoutEnabled}
                            onMouseDown={(e) => handleDragStart(e, 'move', s, isSelected)}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (wasDraggingRef.current) {
                                    wasDraggingRef.current = false;
                                    return;
                                }
                                if (wasSelectedBeforeMousedownRef.current) {
                                    setSelected(null);
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

                {/* Ghost block */}
                {cameraLayoutEnabled && hoverInfo && !selectedId && !dragState && (() => {
                    const ghostTransitionWidthPx = coords.msToX(globalTransitionDurationMs);
                    const totalTransitions = ghostTransitionWidthPx * 2;
                    const clampedTransitionWidth = totalTransitions > hoverInfo.width
                        ? hoverInfo.width / 2
                        : ghostTransitionWidthPx;
                    const holdWidth = Math.max(0, hoverInfo.width - clampedTransitionWidth * 2);

                    return (
                        <div
                            className={ghostCameraLayout.container}
                            style={{
                                left: `${hoverInfo.x}px`,
                                width: `${hoverInfo.width}px`,
                                height,
                            }}
                        >
                            <span className={ghostCameraLayout.label}>+ Layout</span>

                            {/* Ghost transition-in */}
                            {clampedTransitionWidth > 0 && (
                                <div
                                    className={ghostCameraLayout.transitionIn.className}
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: ghostY,
                                        width: clampedTransitionWidth,
                                        ...ghostCameraLayout.transitionIn.getStyle(),
                                        ...(holdWidth <= 0 ? { borderRight: '1px solid var(--block-bg)' } : {}),
                                    }}
                                />
                            )}

                            {/* Ghost hold */}
                            {holdWidth > 0 && (
                                <div
                                    className={`${ghostCameraLayout.hold.className} flex items-center justify-center overflow-hidden`}
                                    style={{
                                        position: 'absolute',
                                        left: clampedTransitionWidth,
                                        top: ghostY,
                                        width: holdWidth,
                                        ...ghostCameraLayout.hold.getStyle(),
                                    }}
                                >
                                    {holdWidth >= MIN_ICON_WIDTH_PX && (
                                        <PiWebcamBold className={blockIconClass} size={BLOCK_ICON_SIZE} />
                                    )}
                                </div>
                            )}

                            {/* Ghost transition-out */}
                            {clampedTransitionWidth > 0 && (
                                <div
                                    className={ghostCameraLayout.transitionOut.className}
                                    style={{
                                        position: 'absolute',
                                        right: 0,
                                        top: ghostY,
                                        width: clampedTransitionWidth,
                                        ...ghostCameraLayout.transitionOut.getStyle(),
                                        ...(holdWidth <= 0 ? { borderLeft: '1px solid var(--block-bg)' } : {}),
                                    }}
                                />
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};
