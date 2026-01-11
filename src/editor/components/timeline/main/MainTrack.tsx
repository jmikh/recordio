import React, { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Timeline as TimelineType } from '../../../../core/types';
import { useProjectSources } from '../../../stores/useProjectStore';
import { useAudioAnalysis } from '../../../hooks/useAudioAnalysis';
import { WaveformSegment } from '../WaveformSegment';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useUIStore } from '../../../stores/useUIStore';
import { TimeMapper } from '../../../../core/timeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';
import { SpeedControl } from './SpeedControl';

export const GROUP_HEADER_HEIGHT = 24;

interface MainTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    trackHeight: number;
}

export const MainTrack: React.FC<MainTrackProps> = ({
    timeline,
    pixelsPerSec,
    trackHeight,
}) => {
    const selectWindow = useUIStore(s => s.selectWindow);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);

    const [speedControlState, setSpeedControlState] = React.useState<{
        windowId: string;
        speed: number;
        anchorEl: HTMLElement;
    } | null>(null);

    const sources = useProjectSources();
    const containerRef = useRef<HTMLDivElement>(null);

    // Create TimePixelMapper for coordinate conversions
    const coords = useMemo(() => {
        const timeMapper = new TimeMapper(timeline.outputWindows);
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeline.outputWindows, pixelsPerSec]);

    // Deselect window when clicking outside this track component
    useClickOutside(containerRef, () => {
        if (selectedWindowId) selectWindow(null);
    });

    // Prepare Audio Analysis for Screen and Camera
    const screenSourceId = timeline.recording.screenSourceId;
    const cameraSourceId = timeline.recording.cameraSourceId;

    const screenSource = sources[screenSourceId];
    const cameraSource = cameraSourceId ? sources[cameraSourceId] : null;

    const screenAudio = useAudioAnalysis(screenSourceId, screenSource?.url);
    const cameraAudio = useAudioAnalysis(cameraSourceId || '', cameraSource?.url || '');

    const { dragState, handleDragStart } = useWindowDrag(timeline, coords);

    // Calculate layout
    let currentX = 0;
    const trackContentHeight = Math.max(0, trackHeight - GROUP_HEADER_HEIGHT);

    return (
        <div ref={containerRef} className="w-full relative bg-surface/50 flex" style={{ height: trackHeight }}>

            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>

                {timeline.outputWindows.map((w) => {
                    const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                    const isSelected = selectedWindowId === w.id;
                    const sourceDurationMs = win.endMs - win.startMs;
                    const speed = win.speed || 1.0;
                    const outputDurationMs = sourceDurationMs / speed;
                    const left = currentX;
                    const width = coords.msToX(outputDurationMs);
                    currentX += width; // Accumulate for next window

                    const hasCamera = !!timeline.recording.cameraSourceId;
                    const sourceStartMs = win.startMs;
                    const sourceEndMs = win.endMs;

                    return (
                        <div
                            key={w.id}
                            className="absolute top-0 bottom-0"
                            style={{ left: `${left}px`, width: `${width}px` }}
                            onClick={(e) => {
                                e.stopPropagation();
                                selectWindow(w.id);
                            }}
                        >
                            {/* Visual Window Content (Clipped) */}
                            <div className={`absolute inset-0 group border rounded-lg overflow-hidden flex flex-col transition-colors ${isSelected ? 'border-primary border-2' : 'border-border-highlight hover:border-border-primary'}`}>
                                {/* Group Header */}
                                <div
                                    style={{ height: GROUP_HEADER_HEIGHT }}
                                    className="bg-surface-elevated border-b border-border px-2 flex items-center justify-between text-xs text-text-muted select-none"
                                >
                                    {/* Duration on left - hide if window too small */}
                                    {width >= 60 && <span>{(outputDurationMs / 1000).toFixed(1)}s</span>}

                                    {/* Speed on right */}
                                    <span
                                        className="cursor-pointer hover:text-primary transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSpeedControlState({
                                                windowId: w.id,
                                                speed: win.speed || 1.0,
                                                anchorEl: e.currentTarget as HTMLElement
                                            });
                                        }}
                                    >
                                        {(() => {
                                            const speed = win.speed || 1.0;
                                            // Format to remove trailing zeros
                                            const formatted = speed.toFixed(2).replace(/\.?0+$/, '');
                                            return `${formatted}x`;
                                        })()}
                                    </span>
                                </div>

                                {/* Tracks Area */}
                                <div className="relative flex-1 w-full">
                                    {/* 1. Screen Segment */}
                                    <div className={`absolute left-0 right-0 top-0 ${hasCamera ? 'bottom-1/2' : 'bottom-0'} bg-primary border border-primary shadow-inner-bold first:border-t-0 last:border-b-0 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center`}>
                                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                            {!screenAudio.isLoading && (
                                                <WaveformSegment
                                                    peaks={screenAudio.peaks}
                                                    sourceStartMs={sourceStartMs}
                                                    sourceEndMs={sourceEndMs}
                                                    width={width}
                                                    height={hasCamera ? trackContentHeight / 2 : trackContentHeight}
                                                    color="var(--secondary-fg)" // Use variable
                                                />
                                            )}
                                        </div>
                                    </div>


                                    {/* 2. Camera Segment (if exists) */}
                                    {
                                        hasCamera && (
                                            <div className="absolute left-0 right-0 bottom-0 top-1/2 bg-tertiary/60 border-b border-tertiary-fg/20 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center">
                                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                                    {!cameraAudio.isLoading && (
                                                        <WaveformSegment
                                                            peaks={cameraAudio.peaks}
                                                            sourceStartMs={sourceStartMs}
                                                            sourceEndMs={sourceEndMs}
                                                            width={width}
                                                            height={trackContentHeight / 2}
                                                            color="var(--tertiary-fg)"
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                        )}
                                </div>
                            </div>

                            {/* Resize Handles (Overlay entire group) */}
                            <div
                                className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-border-highlight z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
                            />
                            <div
                                className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-border-highlight z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
                            />

                            {/* Gap Bubble (Portal) */}
                            {dragState && dragState.windowId === w.id && (() => {
                                const rect = containerRef.current?.getBoundingClientRect();
                                if (!rect) return null;

                                const isLeft = dragState.type === 'left';
                                const indicatorX = rect.left + left + (isLeft ? 0 : width);
                                const indicatorY = rect.bottom;

                                return createPortal(
                                    <div
                                        className="fixed z-[9999] pointer-events-none"
                                        style={{
                                            top: `${indicatorY}px`,
                                            left: `${indicatorX}px`,
                                            transform: isLeft ? 'translate(-50%, 24px)' : 'translate(50%, 24px)' // Add offset to be below
                                        }}
                                    >
                                        <div className="bg-surface-elevated text-text-main text-[10px] font-mono px-1.5 py-0.5 rounded shadow-xl border border-border whitespace-nowrap">
                                            [ {(
                                                (isLeft
                                                    ? (win.startMs - dragState.constraints.minStart)
                                                    : (dragState.constraints.maxEnd - win.endMs)
                                                ) / 1000
                                            ).toFixed(2)}s ]
                                        </div>
                                    </div>,
                                    document.body
                                );
                            })()}
                        </div>
                    );
                })}
            </div >

            {/* Speed Control Popover */}
            {speedControlState && (
                <SpeedControl
                    windowId={speedControlState.windowId}
                    currentSpeed={speedControlState.speed}
                    anchorEl={speedControlState.anchorEl}
                    onClose={() => setSpeedControlState(null)}
                />
            )}
        </div >
    );
};
