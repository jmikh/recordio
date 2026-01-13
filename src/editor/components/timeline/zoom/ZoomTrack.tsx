import React, { useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { TimeMapper } from '../../../../core/timeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useZoomDrag } from './useZoomDrag';
import { useZoomHover } from './useZoomHover';

interface ZoomTrackProps {
    height: number;
}

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

    // Memoize TimeMapper and TimePixelMapper for consistent usage
    const timeMapper = useMemo(() => {
        return new TimeMapper(timeline.outputWindows);
    }, [timeline.outputWindows]);

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

    const { dragState, handleDragStart } = useZoomDrag(
        timeline,
        project,
        coords,
        outputDuration,
        setEditingZoom
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


    const timePerStripe = 0.2; // 0.2s per stripe
    const stripePx = Math.max(4, pixelsPerSec * timePerStripe);
    const halfStripe = stripePx / 2;

    // Shared arrow pattern style
    const arrowPatternStyle: React.CSSProperties = {
        backgroundImage: `
            repeating-linear-gradient(45deg, transparent, transparent ${halfStripe}px, rgba(0,0,0,0.5) ${halfStripe}px, rgba(0,0,0,0.5) ${stripePx}px),
            repeating-linear-gradient(135deg, transparent, transparent ${halfStripe}px, rgba(0,0,0,0.5) ${halfStripe}px, rgba(0,0,0,0.5) ${stripePx}px)
        `,
        backgroundSize: '100% 50%',
        backgroundPosition: 'top left, bottom left',
        backgroundRepeat: 'no-repeat'
    };

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
                {/* Existing Motions */}
                {(() => {
                    const motions = timeline.recording.viewportMotions || [];

                    return motions.map((m, i) => {
                        // Use output time directly
                        const endX = coords.msToX(m.outputEndTimeMs);
                        const width = coords.msToX(m.durationMs);
                        const left = endX - width;

                        if (width <= 0) return null;

                        const isSelected = editingZoomId === m.id;
                        const isDragging = dragState?.motionId === m.id;

                        // Calculate extension to next block
                        let extensionNode = null;
                        const outputSize = project.settings.outputSize;
                        const isFullScreen = Math.abs(m.rect.x) < 1 &&
                            Math.abs(m.rect.y) < 1 &&
                            Math.abs(m.rect.width - outputSize.width) < 1 &&
                            Math.abs(m.rect.height - outputSize.height) < 1;

                        if (!isFullScreen) {
                            const nextM = motions[i + 1];
                            const nextStartMs = nextM ? (nextM.outputEndTimeMs - nextM.durationMs) : outputDuration;

                            // Only extend if there is a gap or we are at the end
                            const nextStartX = coords.msToX(nextStartMs);
                            const extWidth = nextStartX - endX;

                            if (extWidth > 0) {
                                extensionNode = (
                                    <div
                                        className={`absolute top-[4px] bottom-[4px] pointer-events-none border-t border-b border-r rounded-r-xl border-zoomtrack-primary ${isSelected ? 'bg-zoomtrack-primary/50' : 'bg-zoomtrack-primary/30'}`}
                                        style={{
                                            left: `${endX}px`,
                                            width: `${extWidth}px`,
                                            zIndex: 5
                                        }}
                                    />
                                );
                            }
                        }

                        return (
                            <React.Fragment key={m.id}>
                                <div
                                    className={`absolute top-[4px] bottom-[4px] group  transition-colors border
                                        ${isSelected ? 'bg-zoomtrack-primary border-zoomtrack-secondary' : 'bg-zoomtrack-primary/80 not-hover:border-zoomtrack-primary/50 hover:border-zoomtrack-secondary/50 hover:bg-zoomtrack-primary'}
                                        ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
                                    `}
                                    style={{
                                        left: `${left}px`,
                                        width: `${Math.max(width, 2)}px`,
                                        zIndex: isSelected ? 20 : 10,
                                        ...arrowPatternStyle
                                    }}
                                    onMouseDown={(e) => handleDragStart(e, 'move', m)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        console.log('viewportMotion', m);
                                        setEditingZoom(m.id);
                                    }}
                                >

                                    {/* Right Edge (Keyframe) - Thicker, Opaque */}
                                    <div
                                        className={`absolute right-0 top-0 bottom-0 w-1.5 ${isSelected ? 'bg-zoomtrack-secondary' : 'bg-primary-fg/50'} shadow-sm`}
                                    />

                                </div>
                                {extensionNode}
                            </React.Fragment>
                        );
                    });
                })()}

                {/* Add Zoom Indicator */}
                {hoverInfo && !editingZoomId && !dragState && (
                    <div
                        className="absolute top-[4px] bottom-[4px] pointer-events-none z-0 border border-zoomtrack-secondary bg-zoomtrack-secondary/80 rounded-sm flex items-center justify-center"
                        style={{
                            // Use calculated width (pixel based on time)
                            // Position: right aligned to mouse X (hoverInfo.x).
                            // Left = Right - Width
                            left: `${hoverInfo.x - hoverInfo.width}px`,
                            width: `${hoverInfo.width}px`,
                            ...arrowPatternStyle
                        }}
                    >
                        {/* Add Zoom Label (Above) */}
                        <div className="absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-zoomtrack-secondary pointer-events-none bg-surface-elevated/80 px-1 rounded">
                            Add Zoom
                        </div>

                        {/* Right Handle */}
                        <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-zoomtrack-secondary/50" />
                    </div>
                )}
            </div>
        </div >
    );
};
