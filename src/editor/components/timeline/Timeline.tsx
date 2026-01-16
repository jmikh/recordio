// ... imports
import { useRef, useEffect, useState } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { TimelineRuler } from './TimelineRuler';
import { ZoomTrack } from './zoom/ZoomTrack';
import { useTimeMapper } from '../../hooks/useTimeMapper';

// New Components
import { TimelineToolbar, MIN_PIXELS_PER_SEC, MAX_PIXELS_PER_SEC } from './TimelineToolbar';
import { MainTrack, GROUP_HEADER_HEIGHT } from './main/MainTrack';
import { EventsTrack } from './EventsTrack';
import { TimelineTrackHeader } from './TimelineTrackHeader';
import { useTimelineInteraction } from './useTimelineInteraction';
import { TimelinePlayhead } from './TimelinePlayhead';
import { Scrollbar } from '../../../components/ui/Scrollbar';
import { useUIStore } from '../../stores/useUIStore';


// Constants
const TRACK_HEIGHT = 40;
const EVENTS_TRACK_HEIGHT = 20;
const ZOOM_TRACK_HEIGHT = TRACK_HEIGHT * 0.9;
const HEADER_WIDTH = 125;

export function Timeline() {
    //console.log('[Rerender] Timeline');
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayEndRef = useRef<HTMLDivElement>(null);

    const setTimelineContainerRef = useUIStore(s => s.setTimelineContainerRef);

    // Register container ref with UIStore for auto-scroll on setCurrentTime
    useEffect(() => {
        setTimelineContainerRef(containerRef);
        return () => setTimelineContainerRef(null);
    }, [setTimelineContainerRef]);

    const setContainerRef = (node: HTMLDivElement | null) => {
        containerRef.current = node;
        setContainerEl(node);
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const scrollLeft = e.currentTarget.scrollLeft;

        if (overlayRef.current) {
            // shows dark transparent overlay to signfiy more track is hiding.
            const opacity = Math.min(scrollLeft / 200, 1);
            overlayRef.current.style.opacity = opacity.toString();
        }

        if (overlayEndRef.current) {
            const maxScroll = e.currentTarget.scrollWidth - e.currentTarget.clientWidth;
            const remaining = maxScroll - scrollLeft;
            // hide if no scroll
            if (maxScroll <= 0) {
                overlayEndRef.current.style.opacity = '0';
                return;
            }

            const opacity = Math.min(remaining / 200, 1);
            overlayEndRef.current.style.opacity = opacity.toString();
        }
    };

    // -- Stores --
    const timeline = useProjectTimeline();
    const userEvents = useProjectStore(s => s.userEvents);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);


    // -- Derived Data --
    // -- Derived Data --
    const mainTrackHeight = TRACK_HEIGHT + GROUP_HEADER_HEIGHT;

    // Memoize TimeMapper
    const timeMapper = useTimeMapper();

    // Total Duration is now the OUTPUT duration (sum of windows)
    const totalOutputDuration = timeMapper.getOutputDuration();
    const totalWidth = (totalOutputDuration / 1000) * pixelsPerSec + 25;

    const handleFit = () => {
        if (!containerRef.current) return;
        // minimal padding
        const availableWidth = containerRef.current.clientWidth - 50;

        if (totalOutputDuration > 0) {
            const fitPps = (availableWidth * 1000) / totalOutputDuration;
            const clampedPps = Math.max(MIN_PIXELS_PER_SEC, Math.min(MAX_PIXELS_PER_SEC, fitPps));
            setPixelsPerSec(clampedPps);
        }
    };

    // -- Interaction Hook --
    const {
        hoverTime,
        handleMouseMove,
        handleMouseDown,
        handleMouseLeave,
        handleMouseUp
    } = useTimelineInteraction({
        containerRef,
        totalOutputDuration,
        timelineOffsetLeft: 0,
    });



    // --- Deletion Listener ---
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectWindow = useUIStore(s => s.selectWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!selectedWindowId) return;

            // Delete or Backspace
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                removeOutputWindow(selectedWindowId);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedWindowId, removeOutputWindow]);

    // Initial check for overlays
    useEffect(() => {
        const check = () => {
            if (containerRef.current && overlayEndRef.current) {
                const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
                const maxScroll = scrollWidth - clientWidth;

                // Left overlay
                if (overlayRef.current) {
                    overlayRef.current.style.opacity = Math.min(scrollLeft / 200, 1).toString();
                }
                // Right overlay
                if (maxScroll <= 0) {
                    overlayEndRef.current.style.opacity = '0';
                } else {
                    const remaining = maxScroll - scrollLeft;
                    overlayEndRef.current.style.opacity = Math.min(remaining / 200, 1).toString();
                }
            }
        };

        // Helper to debounce or delay slightly to ensure layout
        const timer = setTimeout(check, 0);
        window.addEventListener('resize', check);

        // Also check when content size might change (e.g. totalWidth changes)
        check();

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', check);
        };
    }, [totalOutputDuration, pixelsPerSec]); // deps that affect width

    return (
        <div className="flex flex-col h-full bg-surface select-none text-text-main font-sans">
            {/* 1. Toolbar */}
            <TimelineToolbar
                totalDurationMs={totalOutputDuration}
                onFit={handleFit}
            />

            {/* 2. Timeline Body (Split Pane) */}
            <div className="flex-1 flex bg-surface-raised overflow-hidden relative">

                {/* LEFT COLUMN: HEADERS */}
                <div
                    className="flex-shrink-0 flex flex-col z-20 border-r border-border"
                    style={{ width: HEADER_WIDTH }}
                >
                    {/* Spacer for Ruler */}
                    <div style={{ height: 24 }} className="border-b border-border shrink-0" />

                    {/* Header: Main Track */}
                    <div className="shrink-0" style={{ height: mainTrackHeight }}>
                        <div className="flex flex-col w-full h-full">
                            <div style={{ height: GROUP_HEADER_HEIGHT }} className="border-b border-border" />
                            {!!timeline.recording.cameraSourceId ? (
                                <TimelineTrackHeader
                                    title="Screen & Camera"
                                    height={TRACK_HEIGHT}
                                />
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
                    <div className="shrink-0" style={{ height: ZOOM_TRACK_HEIGHT }}>
                        <TimelineTrackHeader title="Zoom & Pan" height={ZOOM_TRACK_HEIGHT} />
                    </div>

                    {/* Gap */}
                    <div className="h-2 shrink-0" />

                    {/* Header: Events */}
                    <div className="shrink-0" style={{ height: EVENTS_TRACK_HEIGHT }}>
                        <TimelineTrackHeader title="Input Events" height={EVENTS_TRACK_HEIGHT} />
                    </div>

                    {/* Gap */}
                    <div className="h-2 shrink-0" />


                </div>

                {/* RIGHT COLUMN: CONTENT */}
                <div className="flex-1 relative overflow-hidden flex flex-col">

                    <div className="flex-1 relative overflow-hidden w-full h-full">
                        {/* Floating Overlay for Scroll Indication */}
                        <div
                            ref={overlayRef}
                            className="absolute left-0 top-0 bottom-0 w-12 z-30 pointer-events-none"
                            style={{
                                background: 'linear-gradient(to right, rgba(0,0,0,0.5), transparent)',
                                opacity: 0,
                                transition: 'opacity 0.1s ease-out'
                            }}
                        />
                        <div
                            ref={overlayEndRef}
                            className="absolute right-0 top-0 bottom-0 w-12 z-30 pointer-events-none"
                            style={{
                                background: 'linear-gradient(to left, rgba(0,0,0,0.5), transparent)',
                                opacity: 0,
                                transition: 'opacity 0.1s ease-out'
                            }}
                        />

                        <div
                            className="w-full h-full overflow-x-auto overflow-y-hidden relative custom-scrollbar [&::-webkit-scrollbar]:hidden"
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            ref={setContainerRef}
                            onScroll={handleScroll}
                            onMouseMove={handleMouseMove}
                            onMouseDown={handleMouseDown}
                            onMouseLeave={handleMouseLeave}
                            onMouseUp={handleMouseUp}
                            onClick={() => selectWindow(null)}
                        >
                            <div
                                className="relative min-w-full"
                                style={{ width: `${totalWidth}px` }}
                            >
                                {/* Ruler */}
                                <TimelineRuler
                                    totalWidth={totalWidth}
                                    pixelsPerSec={pixelsPerSec}
                                    headerWidth={HEADER_WIDTH}
                                />

                                {/* Tracks Container */}
                                <div className="flex flex-col gap-2 relative pl-0">
                                    {/* Main Track */}
                                    <MainTrack
                                        timeline={timeline}
                                        pixelsPerSec={pixelsPerSec}

                                        trackHeight={mainTrackHeight}
                                    />

                                    {/* Zoom Track */}
                                    <ZoomTrack
                                        height={ZOOM_TRACK_HEIGHT}
                                    />

                                    {/* Events Track */}
                                    <EventsTrack
                                        events={userEvents}
                                        timeMapper={timeMapper}
                                        trackHeight={EVENTS_TRACK_HEIGHT}
                                    />


                                </div>

                                {/* Hover Line */}
                                {hoverTime !== null && (
                                    <div
                                        className="absolute top-0 bottom-0 w-[1px] bg-white/30 z-40 pointer-events-none"
                                        style={{ left: `${(hoverTime / 1000) * pixelsPerSec}px` }}
                                    />
                                )}

                                {/* Playhead (CTI) & Auto-Scroll */}
                                <TimelinePlayhead
                                    containerRef={containerRef}
                                    pixelsPerSec={pixelsPerSec}
                                />
                            </div>
                        </div>

                    </div>
                    <Scrollbar container={containerEl} dependency={pixelsPerSec} className="border-b-0 border-t" />
                </div>
            </div>
        </div>
    );
}

