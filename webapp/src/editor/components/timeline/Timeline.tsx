// ... imports
import { useRef, useEffect, useState } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { TimelineRuler } from './TimelineRuler';
import { ZoomTrack } from './zoom/ZoomTrack';

import { SpotlightTrack } from './spotlight/SpotlightTrack';
import { SpotlightHeaderCell } from './SpotlightHeaderCell';
import { LayoutHeaderCell } from './LayoutHeaderCell';
import { CaptionTrack } from './caption/CaptionTrack';
import { CameraLayoutTrack } from './cameraLayout/CameraLayoutTrack';
import { useTimeMapper } from '../../hooks/useTimeMapper';

// New Components
import { TimelineToolbar, MIN_PIXELS_PER_SEC, MAX_PIXELS_PER_SEC } from './TimelineToolbar';
import { RecordingTrack } from './recording/RecordingTrack';

import { TimelineHeaderCell } from './TimelineHeaderCell';
import { TimelineTrackRow } from './TimelineTrackRow';
import { useTimelineInteraction } from './useTimelineInteraction';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TrackVisibilityDropdown } from './TrackVisibilityDropdown';
import { ZoomHeaderCell } from './ZoomHeaderCell';
import { CaptionsHeaderCell } from './CaptionsHeaderCell';

import { useUIStore } from '../../stores/useUIStore';


// Constants - Unified track height for visual consistency
const TRACK_HEIGHT = 32;
const TRACK_GAP = 4; // Gap between track rows
const HEADER_WIDTH = 120;

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
    const trackVisibility = useUIStore(s => s.trackVisibility);


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

    // Auto-fit timeline zoom on initial mount
    const hasFittedRef = useRef(false);
    useEffect(() => {
        if (!hasFittedRef.current && containerRef.current && totalOutputDuration > 0) {
            hasFittedRef.current = true;
            handleFit();
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
    const selectedCaptionId = useUIStore(s => s.selectedCaptionId);
    const selectCaption = useUIStore(s => s.selectCaption);
    const deleteCaptionSegment = useProjectStore(s => s.deleteCaptionSegment);
    const selectedCameraLayoutId = useUIStore(s => s.selectedCameraLayoutId);
    const selectCameraLayout = useUIStore(s => s.selectCameraLayout);
    const deleteCameraLayout = useProjectStore(s => s.deleteCameraLayout);
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
                } else if (selectedCaptionId) {
                    e.preventDefault();
                    deleteCaptionSegment(selectedCaptionId);
                    selectCaption(null);
                } else if (selectedCameraLayoutId) {
                    e.preventDefault();
                    deleteCameraLayout(selectedCameraLayoutId);
                    selectCameraLayout(null);
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
    }, [selectedWindowId, removeOutputWindow, selectedCaptionId, deleteCaptionSegment, selectCaption, selectWindow, selectedCameraLayoutId, deleteCameraLayout, selectCameraLayout, deselectAllSegments]);

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
            {/* 1. Toolbar */}
            <TimelineToolbar
                totalDurationMs={totalOutputDuration}
                onFit={handleFit}
            />

            {/* 2. Timeline Body (Split Pane) */}
            <div id="timeline-body" className="flex flex-1 bg-surface overflow-hidden relative">

                {/* LEFT COLUMN: HEADERS */}
                <div
                    className="flex-shrink-0 flex flex-col z-[var(--z-index-overlay)] border-r border-border"
                    style={{ width: HEADER_WIDTH, gap: TRACK_GAP, paddingTop: TRACK_GAP }}
                >
                    {/* Track Visibility Dropdown (ruler spacer area) */}
                    <div style={{ height: 24 - TRACK_GAP }} className="border-b border-border shrink-0 flex items-center">
                        <TrackVisibilityDropdown height={24 - TRACK_GAP} />
                    </div>

                    {/* Header: Recording */}
                    {trackVisibility.recording && (
                        <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                            <TimelineHeaderCell
                                title="Recording"
                                height={TRACK_HEIGHT}
                            />
                        </div>
                    )}

                    {/* Header: Zoom */}
                    {trackVisibility.zoom && (
                        <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                            <ZoomHeaderCell height={TRACK_HEIGHT} />
                        </div>
                    )}

                    {/* Header: Spotlight */}
                    {trackVisibility.spotlight && (
                        <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                            <SpotlightHeaderCell height={TRACK_HEIGHT} />
                        </div>
                    )}

                    {/* Header: Captions */}
                    {trackVisibility.captions && (
                        <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                            <CaptionsHeaderCell height={TRACK_HEIGHT} />
                        </div>
                    )}

                    {/* Header: Camera Layout */}
                    {trackVisibility.cameraLayout && (
                        <div className="shrink-0" style={{ height: TRACK_HEIGHT }}>
                            <LayoutHeaderCell height={TRACK_HEIGHT} />
                        </div>
                    )}

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
                                    {/* Recording Track */}
                                    {trackVisibility.recording && (
                                        <TimelineTrackRow height={TRACK_HEIGHT}>
                                            <RecordingTrack
                                                timeline={timeline}
                                                pixelsPerSec={pixelsPerSec}
                                                trackHeight={TRACK_HEIGHT}
                                                scrollLeft={rulerScrollLeft}
                                                containerWidth={containerWidth}
                                            />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Zoom Track */}
                                    {trackVisibility.zoom && (
                                        <TimelineTrackRow height={TRACK_HEIGHT}>
                                            <ZoomTrack height={TRACK_HEIGHT} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Spotlight Track */}
                                    {trackVisibility.spotlight && (
                                        <TimelineTrackRow height={TRACK_HEIGHT}>
                                            <SpotlightTrack height={TRACK_HEIGHT} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Caption Track */}
                                    {trackVisibility.captions && (
                                        <TimelineTrackRow height={TRACK_HEIGHT}>
                                            <CaptionTrack height={TRACK_HEIGHT} />
                                        </TimelineTrackRow>
                                    )}

                                    {/* Camera Layout Track */}
                                    {trackVisibility.cameraLayout && (
                                        <TimelineTrackRow height={TRACK_HEIGHT}>
                                            <CameraLayoutTrack height={TRACK_HEIGHT} />
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

