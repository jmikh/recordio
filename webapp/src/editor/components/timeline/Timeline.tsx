// ... imports
import { useRef, useEffect, useState } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { TimelineRuler } from './TimelineRuler';
import { MIN_PIXELS_PER_SEC, MAX_PIXELS_PER_SEC } from './TimelineToolbar';
import { ZoomTrack } from './tracks/zoom/ZoomTrack';

import { SpotlightTrack } from './tracks/spotlight/SpotlightTrack';
import { SpotlightHeaderCell } from './tracks/spotlight/SpotlightHeaderCell';
import { LayoutHeaderCell } from './tracks/cameraMove/LayoutHeaderCell';

import { CameraMoveTrack } from './tracks/cameraMove/CameraMoveTrack';
import { OverlayTrack } from './tracks/overlay/OverlayTrack';
import { OverlayHeaderCell } from './tracks/overlay/OverlayHeaderCell';
import { useTimeMapper } from '../../hooks/useTimeMapper';

// New Components
import { RecordingTrack } from './tracks/recording/RecordingTrack';
import { RecordingHeaderCell } from './tracks/recording/RecordingHeaderCell';

import { TimelineHeaderCell } from './tracks/shared/TimelineHeaderCell';
import { TimelineTrackRow } from './tracks/shared/TimelineTrackRow';
import { useTimelineInteraction } from './useTimelineInteraction';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineSettings } from './TimelineSettings';
import { ZoomHeaderCell } from './tracks/zoom/ZoomHeaderCell';

import { useTrackSizing, TRACK_GAP } from './tracks/shared/useTrackSizing';

import { useUIStore } from '../../stores/useUIStore';


// Constants
const HEADER_WIDTH = 152;
const RULER_HEIGHT = 26; // 24px canvas + 2px borders (border-t + border-b on ruler wrapper)
const SCROLLBAR_GUTTER = 8; // Space below tracks so horizontal scrollbar doesn't overlap bottom track
const TRANSITION_STYLE = 'height 150ms ease';

export function Timeline() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayEndRef = useRef<HTMLDivElement>(null);

    // Viewport-aware ruler state
    const [rulerScrollLeft, setRulerScrollLeft] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);

    const setTimelineContainerRef = useUIStore(s => s.setTimelineContainerRef);

    // Register container ref with UIStore for auto-scroll on setCurrentTime
    useEffect(() => {
        setTimelineContainerRef(containerRef);
        return () => setTimelineContainerRef(null);
    }, [setTimelineContainerRef]);

    // Track container width via ResizeObserver
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setContainerWidth(el.clientWidth);
        const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, [containerEl]); // re-attach when the element changes

    const setContainerRef = (node: HTMLDivElement | null) => {
        containerRef.current = node;
        setContainerEl(node);
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const scrollLeft = e.currentTarget.scrollLeft;
        setRulerScrollLeft(scrollLeft);

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

    // Attach wheel listener imperatively with { passive: false } so preventDefault works
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            const maxScroll = el.scrollWidth - el.clientWidth;
            if (maxScroll > 0) {
                e.preventDefault();
                // Use deltaX (trackpad horizontal swipe) or deltaY (mouse wheel / trackpad vertical),
                // whichever has larger absolute magnitude
                const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                el.scrollLeft += delta;
            }
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [containerEl]);

    // -- Stores --
    const timeline = useProjectTimeline();
    const hasCameraSource = useProjectStore(s => !!s.project.cameraSource);

    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);
    const displaySettings = useProjectStore(s => s.project.timeline.displaySettings);
    const setHoveredTrack = useUIStore(s => s.setHoveredTrack);
    const { tracks: trackSizing, recordingHeight, totalHeight: timelineTotalHeight } = useTrackSizing();


    // Memoize TimeMapper
    const timeMapper = useTimeMapper();

    // Total Duration is now the OUTPUT duration (sum of windows)
    const totalOutputDuration = timeMapper.getOutputDuration();
    const totalWidth = (totalOutputDuration / 1000) * pixelsPerSec + 25;

    // Auto-fit timeline zoom on initial mount
    const hasFittedRef = useRef(false);
    useEffect(() => {
        if (!hasFittedRef.current && containerRef.current && totalOutputDuration > 0) {
            hasFittedRef.current = true;
            const availableWidth = containerRef.current.clientWidth - 50;
            const fitPps = (availableWidth * 1000) / totalOutputDuration;
            const clampedPps = Math.max(MIN_PIXELS_PER_SEC, Math.min(MAX_PIXELS_PER_SEC, fitPps));
            setPixelsPerSec(clampedPps);
        }
    }, [containerEl, totalOutputDuration]);

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



    // --- Global Key Listeners (Delete + Escape) ---
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectWindow = useUIStore(s => s.selectWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const selectedCameraMoveId = useUIStore(s => s.selectedCameraMoveId);
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const deleteCameraMove = useProjectStore(s => s.deleteCameraMove);
    const selectedOverlaySegmentId = useUIStore(s => s.selectedOverlaySegmentId);
    const selectOverlaySegment = useUIStore(s => s.selectOverlaySegment);
    const deleteOverlaySegment = useProjectStore(s => s.deleteOverlaySegment);
    const deselectAllSegments = useUIStore(s => s.deselectAllSegments);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Delete or Backspace
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Don't delete if user is editing text
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;

                if (selectedWindowId) {
                    e.preventDefault();
                    removeOutputWindow(selectedWindowId);
                } else if (selectedCameraMoveId) {
                    e.preventDefault();
                    deleteCameraMove(selectedCameraMoveId);
                    selectCameraMove(null);
                } else if (selectedOverlaySegmentId) {
                    e.preventDefault();
                    deleteOverlaySegment(selectedOverlaySegmentId);
                    selectOverlaySegment(null);
                }
            }

            // Escape — deselect everything and return to Preview
            if (e.key === 'Escape') {
                // Don't interfere if user is in a text field
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) {
                    (active as HTMLElement).blur();
                }

                deselectAllSegments();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedWindowId, removeOutputWindow, selectWindow, selectedCameraMoveId, deleteCameraMove, selectCameraMove, selectedOverlaySegmentId, deleteOverlaySegment, selectOverlaySegment, deselectAllSegments]);

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
        <div className="flex flex-col h-full bg-surface select-none text-text-highlighted font-sans" style={{ boxShadow: 'inset 0 2px 4px oklch(0 0 0 / 4%)' }}>

            {/* 2. Timeline Body (Split Pane) */}
            <div id="timeline-body" className="flex bg-surface overflow-hidden relative" style={{ height: timelineTotalHeight + SCROLLBAR_GUTTER }} onMouseLeave={() => setHoveredTrack(null)}>

                {/* LEFT COLUMN: HEADERS */}
                <div
                    className="flex-shrink-0 flex flex-col z-[var(--z-index-overlay)] border-r border-border"
                    style={{ width: HEADER_WIDTH }}
                >
                    {/* Track Visibility Dropdown — matches ruler height exactly */}
                    <div style={{ height: RULER_HEIGHT }} className="border-b border-border shrink-0 flex items-center">
                        <TimelineSettings height={RULER_HEIGHT} />
                    </div>

                    {/* Track headers wrapper — mirrors the tracks container on the right */}
                    <div className="flex flex-col" style={{ gap: TRACK_GAP, paddingTop: TRACK_GAP, paddingBottom: TRACK_GAP }}>
                        {/* Header: Recording (always visible) */}
                        <div className="shrink-0" style={{ height: recordingHeight, transition: TRANSITION_STYLE }}>
                            <RecordingHeaderCell height={recordingHeight} />
                        </div>

                        {/* Header: Zoom */}
                        {displaySettings.showZoom && (
                            <div className="shrink-0" style={{ height: trackSizing.zoom.height, transition: TRANSITION_STYLE }} onMouseEnter={() => setHoveredTrack('zoom')}>
                                <ZoomHeaderCell height={trackSizing.zoom.height} isCollapsed={trackSizing.zoom.isCollapsed} />
                            </div>
                        )}

                        {/* Header: Spotlight */}
                        {displaySettings.showSpotlight && (
                            <div className="shrink-0" style={{ height: trackSizing.spotlight.height, transition: TRANSITION_STYLE }} onMouseEnter={() => setHoveredTrack('spotlight')}>
                                <SpotlightHeaderCell height={trackSizing.spotlight.height} isCollapsed={trackSizing.spotlight.isCollapsed} />
                            </div>
                        )}

                        {/* Header: Camera Layout */}
                        {displaySettings.showCameraMove && hasCameraSource && (
                            <div className="shrink-0" style={{ height: trackSizing.cameraMove.height, transition: TRANSITION_STYLE }} onMouseEnter={() => setHoveredTrack('cameraMove')}>
                                <LayoutHeaderCell height={trackSizing.cameraMove.height} isCollapsed={trackSizing.cameraMove.isCollapsed} />
                            </div>
                        )}

                        {/* Header: Overlay */}
                        {displaySettings.showOverlay && (
                            <div className="shrink-0" style={{ height: trackSizing.overlay.height, transition: TRANSITION_STYLE }} onMouseEnter={() => setHoveredTrack('overlay')}>
                                <OverlayHeaderCell height={trackSizing.overlay.height} isCollapsed={trackSizing.overlay.isCollapsed} />
                            </div>
                        )}
                    </div>

                </div>

                {/* RIGHT COLUMN: CONTENT */}
                <div className="flex-1 overflow-hidden flex flex-col">

                    <div className="relative overflow-hidden w-full flex-1">
                        {/* Floating Overlay for Scroll Indication */}
                        <div
                            ref={overlayRef}
                            className="absolute left-0 top-0 bottom-0 w-12 z-[var(--z-index-navbar)] pointer-events-none"
                            style={{
                                background: 'linear-gradient(to right, oklch(0 0 0 / 8%), transparent)',
                                opacity: 0,
                                transition: 'opacity 0.1s ease-out'
                            }}
                        />
                        <div
                            ref={overlayEndRef}
                            className="absolute right-0 top-0 bottom-0 w-12 z-[var(--z-index-navbar)] pointer-events-none"
                            style={{
                                background: 'linear-gradient(to left, oklch(0 0 0 / 8%), transparent)',
                                opacity: 0,
                                transition: 'opacity 0.1s ease-out'
                            }}
                        />

                        <div
                            className="w-full h-full overflow-x-auto overflow-y-hidden relative scrollbar-thin"
                            ref={setContainerRef}
                            onScroll={handleScroll}
                            onMouseMove={handleMouseMove}
                            onMouseDown={handleMouseDown}
                            onMouseLeave={handleMouseLeave}
                            onMouseUp={handleMouseUp}
                            onClick={(e) => {
                                // Only deselect if clicking on empty timeline area, not on segments
                                if (e.target === e.currentTarget) {
                                    selectWindow(null);
                                }
                            }}
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
                                    scrollLeft={rulerScrollLeft}
                                    containerWidth={containerWidth}
                                />

                                {/* Tracks Container */}
                                <div id="timeline-tracks" className="flex flex-col relative pl-0" style={{ gap: TRACK_GAP, paddingTop: TRACK_GAP, paddingBottom: TRACK_GAP }}>
                                    {/* Recording Track (always visible) */}
                                    <TimelineTrackRow height={recordingHeight}>
                                        <RecordingTrack
                                            timeline={timeline}
                                            pixelsPerSec={pixelsPerSec}
                                            trackHeight={recordingHeight}
                                            scrollLeft={rulerScrollLeft}
                                            containerWidth={containerWidth}
                                        />
                                    </TimelineTrackRow>

                                    {/* Zoom Track */}
                                    {displaySettings.showZoom && (
                                        <TimelineTrackRow height={trackSizing.zoom.height} onMouseEnter={() => setHoveredTrack('zoom')}>
                                            <ZoomTrack height={trackSizing.zoom.height} isCollapsed={trackSizing.zoom.isCollapsed} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Spotlight Track */}
                                    {displaySettings.showSpotlight && (
                                        <TimelineTrackRow height={trackSizing.spotlight.height} onMouseEnter={() => setHoveredTrack('spotlight')}>
                                            <SpotlightTrack height={trackSizing.spotlight.height} isCollapsed={trackSizing.spotlight.isCollapsed} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Camera Layout Track */}
                                    {displaySettings.showCameraMove && hasCameraSource && (
                                        <TimelineTrackRow height={trackSizing.cameraMove.height} onMouseEnter={() => setHoveredTrack('cameraMove')}>
                                            <CameraMoveTrack height={trackSizing.cameraMove.height} isCollapsed={trackSizing.cameraMove.isCollapsed} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Overlay Track */}
                                    {displaySettings.showOverlay && (
                                        <TimelineTrackRow height={trackSizing.overlay.height} onMouseEnter={() => setHoveredTrack('overlay')}>
                                            <OverlayTrack height={trackSizing.overlay.height} isCollapsed={trackSizing.overlay.isCollapsed} />
                                        </TimelineTrackRow>
                                    )}

                                </div>

                                {/* Hover Line */}
                                {hoverTime !== null && (
                                    <div
                                        className="absolute top-0 bottom-0 w-[1px] bg-text-muted z-[var(--z-index-overlay)] pointer-events-none"
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

                </div>
            </div>
        </div>
    );
}

