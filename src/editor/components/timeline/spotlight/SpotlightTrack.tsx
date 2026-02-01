import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useSpotlightDrag } from './useSpotlightDrag';
import { useSpotlightHover } from './useSpotlightHover';
import { SpotlightBlock } from './SpotlightBlock';
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

    // Hooks
    const { dragState, handleDragStart } = useSpotlightDrag(
        timeline,
        project,
        coords,
        outputDuration,
        setEditingSpotlight
    );

    const { hoverInfo, handleMouseMove, handleMouseLeave, handleClick } = useSpotlightHover(
        timeline,
        project,
        coords,
        dragState,
        editingSpotlightId,
        setEditingSpotlight,
        outputDuration
    );

    // Calculate fade in/out widths in pixels
    const fadeWidthPx = coords.msToX(transitionDurationMs);

    // Calculate vertical positions for ghost
    const fadeY = (height - FADE_HEIGHT) / 2;
    const holdY = (height - HOLD_HEIGHT) / 2;

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
                {/* Existing Spotlights */}
                {(() => {
                    const spotlightActions = timeline.spotlightActions || [];

                    return spotlightActions.map((s) => {
                        const startX = coords.msToX(s.outputStartTimeMs);
                        const endX = coords.msToX(s.outputEndTimeMs);
                        const totalWidth = endX - startX;

                        if (totalWidth <= 0) return null;

                        const isSelected = editingSpotlightId === s.id;
                        const isDragging = dragState?.spotlightId === s.id;

                        // Calculate actual fade widths (capped to fit within total width)
                        const maxFadeWidth = totalWidth / 3;
                        const actualFadeInWidth = Math.min(fadeWidthPx, maxFadeWidth);
                        const actualFadeOutWidth = Math.min(fadeWidthPx, maxFadeWidth);

                        return (
                            <SpotlightBlock
                                key={s.id}
                                left={startX}
                                width={totalWidth}
                                fadeInWidth={actualFadeInWidth}
                                fadeOutWidth={actualFadeOutWidth}
                                isSelected={isSelected}
                                isDragging={isDragging}
                                trackHeight={height}
                                onMouseDown={(e) => handleDragStart(e, 'move', s)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSpotlight(s.id);
                                }}
                                onResizeStartMouseDown={(e) => {
                                    e.stopPropagation();
                                    handleDragStart(e, 'resize-start', s);
                                }}
                                onResizeEndMouseDown={(e) => {
                                    e.stopPropagation();
                                    handleDragStart(e, 'resize-end', s);
                                }}
                            />
                        );
                    });
                })()}

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
                        {/* Ghost Fade In */}
                        <div
                            className={ghostSpotlight.fadeIn.className}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: fadeY,
                                width: Math.min(fadeWidthPx, hoverInfo.width / 3),
                                ...ghostSpotlight.fadeIn.getStyle(),
                            }}
                        />

                        {/* Ghost Hold */}
                        <div
                            className={ghostSpotlight.hold.className}
                            style={{
                                position: 'absolute',
                                left: Math.min(fadeWidthPx, hoverInfo.width / 3),
                                top: holdY,
                                width: Math.max(0, hoverInfo.width - Math.min(fadeWidthPx, hoverInfo.width / 3) * 2),
                                ...ghostSpotlight.hold.getStyle(),
                            }}
                        >
                            <span className={ghostSpotlight.label}>+ Spotlight</span>
                        </div>

                        {/* Ghost Fade Out */}
                        <div
                            className={ghostSpotlight.fadeOut.className}
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: fadeY,
                                width: Math.min(fadeWidthPx, hoverInfo.width / 3),
                                ...ghostSpotlight.fadeOut.getStyle(),
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
