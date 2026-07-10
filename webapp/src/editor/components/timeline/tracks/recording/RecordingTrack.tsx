import React, { useMemo, useRef } from 'react';
import type { Timeline as TimelineType } from '@shared/types';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useMediaUrlStore } from '../../../../../storage/useMediaUrlStore';
import { useAudioAnalysis } from '../../../../hooks/useAudioAnalysis';
import { useUIStore } from '../../../../stores/useUIStore';
import { getTimeMapper } from '../../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import { useWindowDrag } from './useWindowDrag';
import { FiScissors } from 'react-icons/fi';
import { RecordingSegment } from './RecordingSegment';


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



    const containerRef = useRef<HTMLDivElement | null>(null);

    // Get sources directly from project
    const screenSource = project.screenSource;
    const cameraSource = project.cameraSource;
    const microphoneSource = project.microphoneSource;

    // Create TimePixelMapper for coordinate conversions
    const coords = useMemo(() => {
        const timeMapper = getTimeMapper(timeline.outputWindows);
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeline.outputWindows, pixelsPerSec]);

    // Prepare Audio Analysis: prefer microphone, fallback to video audio if screen has audio
    const mediaUrls = useMediaUrlStore(s => s.urls);
    const audioSourceKey = microphoneSource?.storagePath || (screenSource.hasAudio ? screenSource.storagePath : '');
    const audioSourceUrl = mediaUrls[audioSourceKey] || '';
    const screenAudio = useAudioAnalysis(audioSourceKey, audioSourceUrl);
    const cameraAudio = useAudioAnalysis(cameraSource?.storagePath || '', cameraSource ? (mediaUrls[cameraSource.storagePath] || '') : '');

    const { dragState, handleDragStart } = useWindowDrag(timeline, coords);

    // Floating scissors preview (driven by toolbar scissors button hover)
    const isScissorsHovered = useUIStore(s => s.isScissorsHovered);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const playheadX = (currentTimeMs / 1000) * pixelsPerSec;

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
            {/* Floating scissors preview — shown when toolbar scissors button is hovered */}
            <div
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 p-1.5 rounded-full bg-black/60 text-text-on-primary border border-transparent pointer-events-none transition-[opacity] duration-150 z-[var(--z-index-tooltip)] ${isScissorsHovered ? 'opacity-100' : 'opacity-0'}`}
                style={{ left: `${playheadX}px` }}
            >
                <FiScissors className="icon-sm" />
            </div>

        </div >
    );
};
