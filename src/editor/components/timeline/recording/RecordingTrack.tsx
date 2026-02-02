import React, { useMemo, useRef, useEffect } from 'react';
import type { Timeline as TimelineType } from '../../../../core/types';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useAudioAnalysis } from '../../../hooks/useAudioAnalysis';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useUIStore } from '../../../stores/useUIStore';
import { getTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';
import { SpeedControl } from './SpeedControl';
import { RecordingSegment } from './RecordingSegment';


interface RecordingTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    trackHeight: number;
}

export const RecordingTrack: React.FC<RecordingTrackProps> = ({
    timeline,
    pixelsPerSec,
    trackHeight,
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

    // Deselect window when clicking outside this track component
    useClickOutside(containerRef, () => {
        if (selectedWindowId) selectWindow(null);
    });

    // Escape key to deselect window
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedWindowId) {
                selectWindow(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedWindowId, selectWindow]);

    // Prepare Audio Analysis for Screen and Camera
    const screenAudio = useAudioAnalysis(screenSource.id, screenSource.runtimeUrl || '');
    const cameraAudio = useAudioAnalysis(cameraSource?.id || '', cameraSource?.runtimeUrl || '');

    const { dragState, handleDragStart } = useWindowDrag(timeline, coords);

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
                        />
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
