// ... imports
import { useRef, useState, useMemo } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { TimelineRuler } from './TimelineRuler';
import { TimeMapper } from '../../../core/timeMapper';
import { ZoomTrack } from './ZoomTrack';

// New Components
import { TimelineToolbar } from './TimelineToolbar';
import { MainTrack, GROUP_HEADER_HEIGHT } from './MainTrack';
import { EventsTrack } from './EventsTrack';
import { useTimelineInteraction } from './useTimelineInteraction';

// Constants
const TRACK_HEIGHT = 40;
const HEADER_WIDTH = 200;

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);

    // -- Stores --
    const timeline = useProjectTimeline();
    const splitWindow = useProjectStore(s => s.splitWindow);
    const userEvents = useProjectStore(s => s.userEvents);
    const canvasMode = useProjectStore(s => s.canvasMode);
    const projectSettings = useProjectStore(s => s.project.settings);
    const updateSettings = useProjectStore(s => s.updateSettings);

    const isPlaying = usePlaybackStore(s => s.isPlaying);
    const currentTimeMs = usePlaybackStore(s => s.currentTimeMs);
    const setIsPlaying = usePlaybackStore(s => s.setIsPlaying);

    // Zoom Level (Timeline Scale)
    const [pixelsPerSec, setPixelsPerSec] = useState(100);

    // -- Derived Data --
    const recording = timeline.recording;
    const timelineOffset = recording.timelineOffsetMs;

    // Memoize TimeMapper
    const timeMapper = useMemo(() => {
        return new TimeMapper(timelineOffset, timeline.outputWindows);
    }, [timelineOffset, timeline.outputWindows]);

    // Total Duration is now the OUTPUT duration (sum of windows)
    const totalOutputDuration = timeMapper.getOutputDuration();
    const totalWidth = (totalOutputDuration / 1000) * pixelsPerSec;

    // -- Interaction Hook --
    const {
        hoverTime,
        handleMouseMove,
        handleMouseDown,
        handleMouseLeave,
        handleMouseUp
    } = useTimelineInteraction({
        containerRef,
        pixelsPerSec,
        totalOutputDuration,
        timeMapper,
        canvasMode,
        timelineOffsetLeft: HEADER_WIDTH, // IMPORTANT: Interaction hook layout offset
    });

    // --- Split Action ---
    const handleSplit = () => {
        // Find active window at currentTimeMs
        const activeWinIndex = timeline.outputWindows.findIndex(w => currentTimeMs > w.startMs && currentTimeMs < w.endMs);
        if (activeWinIndex === -1) return;
        const win = timeline.outputWindows[activeWinIndex];
        splitWindow(win.id, currentTimeMs);
    };

    const handleResolutionChange = (width: number, height: number) => {
        updateSettings({ outputSize: { width, height } });
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] select-none text-white font-sans">
            {/* 1. Toolbar */}
            <TimelineToolbar
                onSplit={handleSplit}
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying(!isPlaying)}
                pixelsPerSec={pixelsPerSec}
                onScaleChange={setPixelsPerSec}
                currentTimeMs={timeMapper.mapTimelineToOutputTime(currentTimeMs)}
                totalDurationMs={totalOutputDuration}
                currentResolution={projectSettings.outputSize}
                onResolutionChange={handleResolutionChange}
            />

            {/* 2. Timeline Surface (Single Scroll Container) */}
            <div
                className="flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar bg-[#1e1e1e]"
                ref={containerRef}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
            >
                <div
                    className="relative min-w-full"
                    style={{ width: `${Math.max(totalWidth + HEADER_WIDTH + 400, window.innerWidth)}px` }}
                >
                    {/* Ruler */}
                    <TimelineRuler
                        totalWidth={totalWidth}
                        pixelsPerSec={pixelsPerSec}
                        paddingLeft={HEADER_WIDTH}
                    />

                    {/* Tracks Container */}
                    <div className="py-2 flex flex-col gap-2 relative pl-0">

                        {/* ROW 1: Main Track (Screen + Camera) */}
                        <MainTrack
                            timeline={timeline}
                            pixelsPerSec={pixelsPerSec}
                            accumulatedX={0}
                            trackHeight={(timeline.recording.cameraSourceId ? TRACK_HEIGHT * 2 : TRACK_HEIGHT) + GROUP_HEADER_HEIGHT}
                            headerWidth={HEADER_WIDTH}
                        />

                        {/* ROW 2: Viewport Motions (Zoom) */}
                        <ZoomTrack
                            pixelsPerSec={pixelsPerSec}
                            height={TRACK_HEIGHT}
                            timelineOffset={timelineOffset}
                            headerWidth={HEADER_WIDTH}
                        />

                        {/* ROW 3: Events (Clicks/Drags) */}
                        <EventsTrack
                            events={userEvents}
                            pixelsPerSec={pixelsPerSec}
                            timelineOffset={timelineOffset}
                            timeMapper={timeMapper}
                            trackHeight={TRACK_HEIGHT}
                            headerWidth={HEADER_WIDTH}
                        />
                    </div>

                    {/* ... (HoverLine and CTI stay here) ... */}

                    {/* Hover Line */}
                    {hoverTime !== null && (
                        <div
                            className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-20 pointer-events-none"
                            style={{ left: `${(hoverTime / 1000) * pixelsPerSec + HEADER_WIDTH}px` }}
                        />
                    )}

                    {/* CTI (Playhead) */}
                    {(() => {
                        const ctiOutputTime = timeMapper.mapTimelineToOutputTime(currentTimeMs);
                        if (ctiOutputTime === -1) return null;
                        return (
                            <div
                                className="absolute top-0 bottom-0 w-[1px] bg-red-500 z-30 pointer-events-none"
                                style={{ left: `${(ctiOutputTime / 1000) * pixelsPerSec + HEADER_WIDTH}px` }}
                            >
                                <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-500"></div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
