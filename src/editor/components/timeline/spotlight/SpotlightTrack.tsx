import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useSpotlightDrag } from './useSpotlightDrag';
import { useSpotlightHover } from './useSpotlightHover';

interface SpotlightTrackProps {
    height: number;
}

export const SpotlightTrack: React.FC<SpotlightTrackProps> = ({ height }) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const timeline = useProjectTimeline();

    // UI State
    const editingSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const setEditingSpotlight = (id: string | null) => {
        useUIStore.getState().selectSpotlight(id);
    };

    const project = useProjectStore(s => s.project);

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

    // Visual constants
    const HANDLE_WIDTH = 6;

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
                {/* Full-width overlay bar for spotlight track */}
                <div
                    className="absolute top-[4px] bottom-[4px] left-0 right-0 bg-surface-overlay rounded-sm"
                    style={{ zIndex: 1 }}
                />

                {/* Existing Spotlights */}
                {(() => {
                    const spotlights = timeline.spotlights || [];

                    return spotlights.map((s) => {
                        const startX = coords.msToX(s.outputStartTimeMs);
                        const endX = coords.msToX(s.outputEndTimeMs);
                        const width = endX - startX;

                        if (width <= 0) return null;

                        const isSelected = editingSpotlightId === s.id;
                        const isDragging = dragState?.spotlightId === s.id;

                        return (
                            <div
                                key={s.id}
                                className={`absolute top-[4px] bottom-[4px] group transition-colors rounded-sm
                                    ${isSelected ? 'border-2 border-amber-400 bg-amber-500/30' : 'border border-amber-600/50 bg-amber-500/20 hover:border-amber-400 hover:bg-amber-500/30'}
                                    ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
                                `}
                                style={{
                                    left: `${startX}px`,
                                    width: `${Math.max(width, 2)}px`,
                                    zIndex: isSelected ? 20 : 10,
                                }}
                                onMouseDown={(e) => handleDragStart(e, 'move', s)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSpotlight(s.id);
                                }}
                            >
                                {/* Left resize handle */}
                                <div
                                    className="absolute left-0 top-0 bottom-0 cursor-ew-resize hover:bg-amber-400/50"
                                    style={{ width: HANDLE_WIDTH }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        handleDragStart(e, 'resize-start', s);
                                    }}
                                />

                                {/* Right resize handle */}
                                <div
                                    className="absolute right-0 top-0 bottom-0 cursor-ew-resize hover:bg-amber-400/50"
                                    style={{ width: HANDLE_WIDTH }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        handleDragStart(e, 'resize-end', s);
                                    }}
                                />

                                {/* Center label (for wider blocks) */}
                                {width > 60 && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <span className="text-[10px] text-amber-200/70 truncate px-2">
                                            Spotlight
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    });
                })()}

                {/* Add Spotlight Indicator (hover ghost) */}
                {hoverInfo && !editingSpotlightId && !dragState && (
                    <div
                        className="absolute top-[4px] bottom-[4px] pointer-events-none z-[6] border-2 border-dashed border-amber-400 bg-amber-500/20 rounded-sm flex items-center justify-center"
                        style={{
                            left: `${hoverInfo.x}px`,
                            width: `${hoverInfo.width}px`,
                        }}
                    >
                        <span className="text-[10px] text-amber-200 pointer-events-none bg-surface-overlay/80 px-1 rounded">
                            + Spotlight
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
