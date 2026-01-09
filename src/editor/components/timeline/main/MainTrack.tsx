import React, { useMemo, useRef } from 'react';
import type { Timeline as TimelineType } from '../../../../core/types';
import { useProjectSources } from '../../../stores/useProjectStore';
import { useAudioAnalysis } from '../../../hooks/useAudioAnalysis';
import { WaveformSegment } from '../WaveformSegment';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useUIStore } from '../../../stores/useUIStore';
import { TimeMapper } from '../../../../core/timeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';

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
        <div ref={containerRef} className="w-full relative bg-[#2a2a2a]/50 flex" style={{ height: trackHeight }}>

            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>

                {timeline.outputWindows.map((w) => {
                    const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                    const isSelected = selectedWindowId === w.id;
                    const durationMs = win.endMs - win.startMs;
                    const left = currentX;
                    const width = coords.msToX(durationMs);
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
                            <div className={`absolute inset-0 group border rounded-lg overflow-hidden flex flex-col transition-colors ${isSelected ? 'border-yellow-500 border-2' : 'border-white/20 hover:border-white/40'}`}>
                                {/* Group Header */}
                                <div
                                    style={{ height: GROUP_HEADER_HEIGHT }}
                                    className="bg-white/5 border-b border-white/10 px-2 flex items-center text-xs text-white/50 select-none"
                                >
                                    {(durationMs / 1000).toFixed(1)}s
                                </div>

                                {/* Tracks Area */}
                                <div className="relative flex-1 w-full">
                                    {/* 1. Screen Segment */}
                                    <div className={`absolute left-0 right-0 top-0 ${hasCamera ? 'bottom-1/2' : 'bottom-0'} bg-blue-900/60 border-y border-blue-500/40 first:border-t-0 last:border-b-0 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center`}>
                                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                            {!screenAudio.isLoading && (
                                                <WaveformSegment
                                                    peaks={screenAudio.peaks}
                                                    sourceStartMs={sourceStartMs}
                                                    sourceEndMs={sourceEndMs}
                                                    width={width}
                                                    height={hasCamera ? trackContentHeight / 2 : trackContentHeight}
                                                    color="#bfdbfe" // blue-200
                                                />
                                            )}
                                        </div>
                                    </div>


                                    {/* 2. Camera Segment (if exists) */}
                                    {
                                        hasCamera && (
                                            <div className="absolute left-0 right-0 bottom-0 top-1/2 bg-purple-900/60 border-b border-purple-500/40 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center">
                                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                                    {!cameraAudio.isLoading && (
                                                        <WaveformSegment
                                                            peaks={cameraAudio.peaks}
                                                            sourceStartMs={sourceStartMs}
                                                            sourceEndMs={sourceEndMs}
                                                            width={width}
                                                            height={trackContentHeight / 2}
                                                            color="#e9d5ff" // purple-200
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                        )}
                                </div>
                            </div>

                            {/* Resize Handles (Overlay entire group) */}
                            <div
                                className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
                            />
                            <div
                                className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
                            />

                            {/* Gap Bubble */}
                            {dragState && dragState.windowId === w.id && (
                                <div
                                    className="absolute -bottom-6 bg-black/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded shadow-xl border border-white/10 z-50 pointer-events-none whitespace-nowrap"
                                    style={{
                                        [dragState.type === 'left' ? 'left' : 'right']: 0,
                                        transform: dragState.type === 'left' ? 'translateX(-50%)' : 'translateX(50%)',
                                    }}
                                >
                                    [ {(
                                        (dragState.type === 'left'
                                            ? (win.startMs - dragState.constraints.minStart)
                                            : (dragState.constraints.maxEnd - win.endMs)
                                        ) / 1000
                                    ).toFixed(2)}s ]
                                </div>
                            )}
                        </div>
                    );
                })}
            </div >
        </div >
    );
};
