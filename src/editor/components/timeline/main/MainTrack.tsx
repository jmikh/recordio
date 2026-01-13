import React, { useMemo, useRef } from 'react';
import type { Timeline as TimelineType } from '../../../../core/types';
import { useProjectSources, useProjectStore } from '../../../stores/useProjectStore';
import { useAudioAnalysis } from '../../../hooks/useAudioAnalysis';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useUIStore } from '../../../stores/useUIStore'; // Removed unused useUIStore
import { getTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';
import { SpeedControl } from './SpeedControl';
import { MainTrackItem } from './MainTrackItem'; // Imported MainTrackItem

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
    const project = useProjectStore(s => s.project);

    const [speedControlState, setSpeedControlState] = React.useState<{
        windowId: string;
        speed: number;
        anchorEl: HTMLElement;
    } | null>(null);

    const sources = useProjectSources();
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Create TimePixelMapper for coordinate conversions
    const coords = useMemo(() => {
        const timeMapper = getTimeMapper(timeline.outputWindows);
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

                    const speed = win.speed || 1.0;
                    const outputDurationMs = (win.endMs - win.startMs) / speed;
                    const left = currentX;
                    const width = coords.msToX(outputDurationMs);
                    currentX += width; // Accumulate for next window

                    const hasCamera = !!timeline.recording.cameraSourceId;
                    const isMuted = project.settings.screen?.mute ?? false;

                    return (
                        <MainTrackItem
                            key={w.id}
                            outputWindow={w}
                            dragState={dragState}
                            isSelected={selectedWindowId === w.id}
                            left={left}
                            width={width}
                            trackContentHeight={trackContentHeight}
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
