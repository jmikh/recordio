import React, { useMemo, useRef, useEffect } from 'react';
import type { Timeline as TimelineType } from '../../../../types';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useAudioAnalysis } from '../../../hooks/useAudioAnalysis';
import { useUIStore, CanvasMode } from '../../../stores/useUIStore';
import { getTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';
import { SpeedControl } from './SpeedControl';
import { RecordingSegment } from './RecordingSegment';
import { MIN_WINDOW_DURATION_MS } from './constants';
import { FaScissors } from 'react-icons/fa6';


interface RecordingTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    trackHeight: number;
    scrollLeft: number;
    containerWidth: number;
}

export const RecordingTrack: React.FC<RecordingTrackProps> = ({
    timeline,
    pixelsPerSec,
    trackHeight,
    scrollLeft,
    containerWidth,
}) => {
    const selectWindow = useUIStore(s => s.selectWindow);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const project = useProjectStore(s => s.project);

    const [speedControlState, setSpeedControlState] = React.useState<{
        windowId: string;
        speed: number;
        anchorEl: HTMLElement;
    } | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);

    // Get sources directly from project
    const screenSource = project.screenSource;
    const cameraSource = project.cameraSource;

    // Create TimePixelMapper for coordinate conversions
    const coords = useMemo(() => {
        const timeMapper = getTimeMapper(timeline.outputWindows);
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeline.outputWindows, pixelsPerSec]);

    // Prepare Audio Analysis for Screen and Camera
    const screenAudio = useAudioAnalysis(screenSource.id, screenSource.runtimeUrl || '');
    const cameraAudio = useAudioAnalysis(cameraSource?.id || '', cameraSource?.runtimeUrl || '');

    const { dragState, handleDragStart } = useWindowDrag(timeline, coords);

    // Scissors button state
    const canvasMode = useUIStore(s => s.canvasMode);
    const isPlaying = useUIStore(s => s.isPlaying);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const splitWindow = useProjectStore(s => s.splitWindow);

    // Check if current time is at least MIN_WINDOW_DURATION_MS from both window boundaries (in output time)
    const canShowScissors = useMemo(() => {
        const timeMapper = getTimeMapper(timeline.outputWindows);
        const result = timeMapper.getWindowAtOutputTime(currentTimeMs);
        if (!result) return false;

        const { window: win, outputStartMs } = result;
        const speed = win.speed || 1.0;
        const windowOutputDuration = (win.endMs - win.startMs) / speed;
        const windowOutputEndMs = outputStartMs + windowOutputDuration;

        // Calculate distances in output time
        const distanceFromStart = currentTimeMs - outputStartMs;
        const distanceFromEnd = windowOutputEndMs - currentTimeMs;

        return distanceFromStart >= MIN_WINDOW_DURATION_MS && distanceFromEnd >= MIN_WINDOW_DURATION_MS;
    }, [currentTimeMs, timeline.outputWindows]);

    const showScissors = canvasMode === CanvasMode.Preview && !isPlaying && canShowScissors;

    // Playhead X position for scissors button
    const playheadX = (currentTimeMs / 1000) * pixelsPerSec;

    // Split handler
    const handleScissorsClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        const timeMapper = getTimeMapper(timeline.outputWindows);
        const result = timeMapper.getWindowAtOutputTime(currentTimeMs);
        if (!result) return;

        const { window: win, outputStartMs } = result;
        const outputOffset = currentTimeMs - outputStartMs;
        const speed = win.speed || 1.0;
        const sourceOffset = outputOffset * speed;
        const splitTime = win.startMs + sourceOffset;

        splitWindow(win.id, splitTime);
    };

    // Calculate layout
    let currentX = 0;

    return (
        <div ref={containerRef} className="w-full relative flex" style={{ height: trackHeight }}>

            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>

                {timeline.outputWindows.map((seg) => {
                    const win = (dragState && dragState.windowId === seg.id) ? dragState.currentWindow : seg;

                    const speed = win.speed || 1.0;
                    const outputDurationMs = (win.endMs - win.startMs) / speed;
                    const left = currentX;
                    const width = coords.msToX(outputDurationMs);
                    currentX += width; // Accumulate for next window

                    const hasCamera = !!cameraSource;
                    const isMuted = project.settings.screen?.mute ?? false;

                    return (
                        <RecordingSegment
                            key={seg.id}
                            outputWindow={seg}
                            dragState={dragState}
                            isSelected={selectedWindowId === seg.id}
                            left={left}
                            width={width}
                            trackContentHeight={trackHeight}
                            selectWindow={selectWindow}
                            handleDragStart={handleDragStart}
                            setSpeedControlState={setSpeedControlState}
                            containerRef={containerRef}
                            screenAudio={screenAudio}
                            cameraAudio={cameraAudio}
                            isMuted={isMuted}
                            hasCamera={hasCamera}
                            scrollLeft={scrollLeft}
                            containerWidth={containerWidth}
                        />
                    );
                })}
            </div>

            {/* Scissors Split Button */}
            <button
                onClick={handleScissorsClick}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={(e) => e.stopPropagation()}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 p-1.5 rounded-full bg-black/60 text-gray-200 border border-transparent hover:bg-black/80 hover:text-gray-100 hover:border-border-hover hover:scale-110 cursor-pointer transition-[opacity,background-color,border-color,color,scale] duration-150 z-[var(--z-index-tooltip)] ${showScissors ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                style={{ left: `${playheadX}px` }}
                title="Split at playhead"
            >
                <FaScissors size={12} />
            </button>

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
