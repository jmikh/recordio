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
import { TimelineTrackHeader } from './TimelineTrackHeader';
import { useTimelineInteraction } from './useTimelineInteraction';
import { TimelinePlayhead } from './TimelinePlayhead';

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
    // Note: We deliberately DO NOT subscribe to currentTimeMs here to prevent re-renders
    const setIsPlaying = usePlaybackStore(s => s.setIsPlaying);

    // We only need currentTimeMs for the Toolbar
    const currentTimeMs = usePlaybackStore(s => s.currentTimeMs);

    // Zoom Level (Timeline Scale)
    const [pixelsPerSec, setPixelsPerSec] = useState(100);

    // -- Derived Data --
    const recording = timeline.recording;
    const timelineOffset = recording.timelineOffsetMs;
    const mainTrackHeight = (timeline.recording.cameraSourceId ? TRACK_HEIGHT * 2 : TRACK_HEIGHT) + GROUP_HEADER_HEIGHT;

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
        timelineOffsetLeft: 0,
    });

    // --- Split Action ---
    const handleSplit = () => {
        // Find active window at currentTimeMs
        // We use the store value directly via current TimeMapper
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

            {/* 2. Timeline Body (Split Pane) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* LEFT COLUMN: HEADERS */}
                <div
                    className="flex-shrink-0 flex flex-col z-20 bg-[#1e1e1e] border-r border-[#333]"
                    style={{ width: HEADER_WIDTH }}
                >
                    {/* Spacer for Ruler */}
                    <div style={{ height: 24 }} className="border-b border-[#333] shrink-0" />

                    {/* Header: Main Track */}
                    <div className="shrink-0" style={{ height: mainTrackHeight }}>
                        <div className="flex flex-col w-full h-full">
                            <div style={{ height: GROUP_HEADER_HEIGHT }} className="border-b border-white/5 bg-[#2a2a2a]/50" />
                            {!!timeline.recording.cameraSourceId ? (
                                <div className="flex flex-col flex-1">
                                    <TimelineTrackHeader
                                        title="Screen"
                                        height={TRACK_HEIGHT}
                                    />
                                    <TimelineTrackHeader
                                        title="Camera"
                                        height={TRACK_HEIGHT}
                                    />
                                </div>
                            ) : (
                                <TimelineTrackHeader
                                    title="Screen"
                                    height={TRACK_HEIGHT}
                                />
                            )}
                        </div>
                    </div>

                    {/* Gap */}
                    <div className="h-2 shrink-0" />

                    {/* Header: Zoom */}
                    <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                        <TimelineTrackHeader title="Zoom & Pan" height={TRACK_HEIGHT} />
                    </div>

                    {/* Gap */}
                    <div className="h-2 shrink-0" />

                    {/* Header: Events */}
                    <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                        <TimelineTrackHeader title="Input Events" height={TRACK_HEIGHT} />
                    </div>
                </div>

                {/* RIGHT COLUMN: CONTENT */}
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
                        style={{ width: `${Math.max(totalWidth + 400, window.innerWidth - HEADER_WIDTH)}px` }}
                    >
                        {/* Ruler */}
                        <TimelineRuler
                            totalWidth={totalWidth}
                            pixelsPerSec={pixelsPerSec}
                        />

                        {/* Tracks Container */}
                        <div className="flex flex-col gap-2 relative pl-0">
                            {/* Main Track */}
                            <MainTrack
                                timeline={timeline}
                                pixelsPerSec={pixelsPerSec}
                                accumulatedX={0}
                                trackHeight={mainTrackHeight}
                            />

                            {/* Zoom Track */}
                            <ZoomTrack
                                pixelsPerSec={pixelsPerSec}
                                height={TRACK_HEIGHT}
                                timelineOffset={timelineOffset}
                            />

                            {/* Events Track */}
                            <EventsTrack
                                events={userEvents}
                                pixelsPerSec={pixelsPerSec}
                                timelineOffset={timelineOffset}
                                timeMapper={timeMapper}
                                trackHeight={TRACK_HEIGHT}
                            />
                        </div>

                        {/* Hover Line */}
                        {hoverTime !== null && (
                            <div
                                className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-20 pointer-events-none"
                                style={{ left: `${(hoverTime / 1000) * pixelsPerSec}px` }}
                            />
                        )}

                        {/* Playhead (CTI) & Auto-Scroll */}
                        <TimelinePlayhead
                            containerRef={containerRef}
                            pixelsPerSec={pixelsPerSec}
                            timeMapper={timeMapper}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

