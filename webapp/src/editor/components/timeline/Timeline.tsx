// ... imports
import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { TimelineRuler } from './TimelineRuler';
import { fitTimelineToScreen, MIN_PIXELS_PER_SEC, MAX_PIXELS_PER_SEC } from './fitTimeline';
import { ZoomTrack } from './tracks/zoom/ZoomTrack';

import { SpotlightTrack } from './tracks/spotlight/SpotlightTrack';
import { SpotlightHeaderCell } from './tracks/spotlight/SpotlightHeaderCell';
import { LayoutHeaderCell } from './tracks/cameraMove/LayoutHeaderCell';

import { CameraMoveTrack } from './tracks/cameraMove/CameraMoveTrack';
import { BlurTrack } from './tracks/blur/BlurTrack';
import { BlurHeaderCell } from './tracks/blur/BlurHeaderCell';
import { useTimeMapper } from '../../hooks/useTimeMapper';

// New Components
import { ClipTrack } from './tracks/clip/ClipTrack';
import { ClipHeaderCell } from './tracks/clip/ClipHeaderCell';

import { TimelineHeaderCell } from './tracks/shared/TimelineHeaderCell';
import { TimelineTrackRow } from './tracks/shared/TimelineTrackRow';
import { useTimelineInteraction } from './useTimelineInteraction';
import { TimelinePlayhead } from './TimelinePlayhead';
import { TimelineSettings } from './TimelineSettings';
import { ZoomHeaderCell } from './tracks/zoom/ZoomHeaderCell';

import { useTrackSizing, TRACK_GAP } from './tracks/shared/useTrackSizing';

import { useUIStore } from '../../stores/useUIStore';


// Constants
const HEADER_WIDTH = 40;
const RULER_HEIGHT = 26; // 24px canvas + 2px borders (border-t + border-b on ruler wrapper)
const SCROLLBAR_GUTTER = 8; // Space below tracks so horizontal scrollbar doesn't overlap bottom track
const TRANSITION_STYLE = 'height 150ms ease';
// Wheel zoom: scale factor per wheel delta pixel (exponential so zoom feels uniform at any level)
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_MAX_DELTA = 40;

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
        const ro = new ResizeObserver(([entry]) => { console.log('[FitDebug] resize', { width: entry.contentRect.width, t: performance.now() }); setContainerWidth(entry.contentRect.width); });
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

    // Time under the cursor when a wheel zoom started. Applied to scrollLeft in a layout effect
    // once the new width is in the DOM (setting it earlier would clamp to the old scrollWidth).
    const zoomAnchorRef = useRef<{ timeSec: number; cursorX: number } | null>(null);

    // Attach wheel listener imperatively with { passive: false } so preventDefault works
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const zoomAtCursor = (e: WheelEvent) => {
            const { pixelsPerSec, setPixelsPerSec } = useUIStore.getState();
            // Firefox reports mouse wheels in lines; normalize to pixels and cap so a wheel notch
            // is a comfortable step while small trackpad pinch deltas stay smooth
            const deltaPx = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
            const delta = Math.max(-WHEEL_ZOOM_MAX_DELTA, Math.min(WHEEL_ZOOM_MAX_DELTA, deltaPx));
            const nextPps = Math.max(MIN_PIXELS_PER_SEC, Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)));
            if (nextPps === pixelsPerSec) return;

            // Wheel events can outpace renders; keep a pending anchor since scrollLeft hasn't caught up yet
            if (!zoomAnchorRef.current) {
                const cursorX = e.clientX - el.getBoundingClientRect().left;
                zoomAnchorRef.current = { timeSec: (el.scrollLeft + cursorX) / pixelsPerSec, cursorX };
            }
            setPixelsPerSec(nextPps);
        };

        const handleWheel = (e: WheelEvent) => {
            // Trackpad pinch arrives as a wheel event with ctrlKey set; cmd/ctrl + scroll zooms too
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                zoomAtCursor(e);
                return;
            }

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
    const displaySettings = useProjectStore(s => s.project.timeline.displaySettings);
    const setHoveredTrack = useUIStore(s => s.setHoveredTrack);
    const { tracks: trackSizing, clipHeight, totalHeight: timelineTotalHeight } = useTrackSizing();

    // Keep the time under the cursor in place after a wheel zoom. Ruler/clip culling reads
    // rulerScrollLeft, so sync it here too instead of waiting a frame for the scroll event.
    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current;
        const el = containerRef.current;
        zoomAnchorRef.current = null;
        if (!anchor || !el) return;
        el.scrollLeft = anchor.timeSec * pixelsPerSec - anchor.cursorX;
        setRulerScrollLeft(el.scrollLeft);
    }, [pixelsPerSec]);


    // Memoize TimeMapper
    const timeMapper = useTimeMapper();

    // Total Duration is now the OUTPUT duration (sum of windows)
    const totalOutputDuration = timeMapper.getOutputDuration();
    const totalWidth = (totalOutputDuration / 1000) * pixelsPerSec + 25;

    // Fit the timeline once per loaded project, after the container has been measured
    // and the project's duration is known (same function as the toolbar's Fit button)
    const projectId = useProjectStore(s => s.project.id);
    const fittedProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (fittedProjectIdRef.current === projectId) return;
        if (containerWidth <= 0 || totalOutputDuration <= 0) return;
        fittedProjectIdRef.current = projectId;
        fitTimelineToScreen(totalOutputDuration);
    }, [projectId, containerWidth, totalOutputDuration]);

    // -- Interaction Hook --
    const {
        hoverTime,
        isDraggingHighlight,
        handleMouseMove,
        handleMouseDown,
        handleMouseLeave,
        handleMouseUp
    } = useTimelineInteraction({
        containerRef,
        totalOutputDuration,
        timelineOffsetLeft: 0,
    });



    // --- Highlighted Range ---
    const highlightRange = useUIStore(s => s.highlightRange);
    const cutOutputRange = useProjectStore(s => s.cutOutputRange);

    // --- Global Key Listeners (Delete + Escape) ---
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectWindow = useUIStore(s => s.selectWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const selectedCameraMoveId = useUIStore(s => s.selectedCameraMoveId);
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const deleteCameraMove = useProjectStore(s => s.deleteCameraMove);
    const selectedBlurSegmentId = useUIStore(s => s.selectedBlurSegmentId);
    const deselectAllSegments = useUIStore(s => s.deselectAllSegments);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Delete or Backspace
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Don't delete if user is editing text
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;

                // Check for highlighted range first
                const range = useUIStore.getState().highlightRange;
                if (range) {
                    e.preventDefault();
                    cutOutputRange(range.startMs, range.endMs);
                    useUIStore.getState().setHighlightRange(null);
                    return;
                }

                if (selectedWindowId) {
                    e.preventDefault();
                    removeOutputWindow(selectedWindowId);
                } else if (selectedCameraMoveId) {
                    e.preventDefault();
                    deleteCameraMove(selectedCameraMoveId);
                    selectCameraMove(null);
                } else if (selectedBlurSegmentId) {
                    e.preventDefault();
                    deleteSelectedBlurRegion();
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
    }, [selectedWindowId, removeOutputWindow, selectWindow, selectedCameraMoveId, deleteCameraMove, selectCameraMove, selectedBlurSegmentId, deselectAllSegments, cutOutputRange]);

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
                    <div style={{ height: RULER_HEIGHT }} className="bg-surface border-b border-border shrink-0 flex items-center">
                        <TimelineSettings height={RULER_HEIGHT} />
                    </div>

                    {/* Track headers wrapper — mirrors the tracks container on the right */}
                    <div className="flex flex-col" style={{ gap: TRACK_GAP, paddingTop: TRACK_GAP, paddingBottom: TRACK_GAP }}>
                        {/* Header: Clip (always visible) */}
                        <div className="shrink-0" style={{ height: clipHeight, transition: TRANSITION_STYLE }}>
                            <ClipHeaderCell height={clipHeight} />
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

                        {/* Header: Blur */}
                        {displaySettings.showBlur && (
                            <div className="shrink-0" style={{ height: trackSizing.blur.height, transition: TRANSITION_STYLE }} onMouseEnter={() => setHoveredTrack('blur')}>
                                <BlurHeaderCell height={trackSizing.blur.height} isCollapsed={trackSizing.blur.isCollapsed} />
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
                            style={isDraggingHighlight ? { cursor: 'col-resize' } : undefined}
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
                                <div id="timeline-tracks" className={`flex flex-col relative pl-0 ${isDraggingHighlight ? 'pointer-events-none' : ''}`} style={{ gap: TRACK_GAP, paddingTop: TRACK_GAP, paddingBottom: TRACK_GAP }}>
                                    {/* Clip Track (always visible) */}
                                    <TimelineTrackRow height={clipHeight}>
                                        <ClipTrack
                                            timeline={timeline}
                                            pixelsPerSec={pixelsPerSec}
                                            trackHeight={clipHeight}
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

                                    {/* Blur Track */}
                                    {displaySettings.showBlur && (
                                        <TimelineTrackRow height={trackSizing.blur.height} onMouseEnter={() => setHoveredTrack('blur')}>
                                            <BlurTrack height={trackSizing.blur.height} isCollapsed={trackSizing.blur.isCollapsed} />
                                        </TimelineTrackRow>
                                    )}

                                </div>

                                {/* Highlighted Segment Overlay */}
                                {highlightRange && (
                                    <div
                                        className="absolute top-0 bottom-0 pointer-events-none z-31 bg-secondary/20 border-l border-r border-secondary/50"
                                        style={{
                                            left: `${(highlightRange.startMs / 1000) * pixelsPerSec}px`,
                                            width: `${((highlightRange.endMs - highlightRange.startMs) / 1000) * pixelsPerSec}px`,
                                        }}
                                    />
                                )}

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

/**
 * Delete key on a selected blur block removes the region being edited on the
 * canvas (the store drops the block with its last region), then moves the
 * selection to a remaining region or clears it.
 */
function deleteSelectedBlurRegion() {
    const { selectedBlurSegmentId, selectedBlurRegionId, selectBlurSegment, selectBlurRegion } = useUIStore.getState();
    const { project, deleteBlurRegion } = useProjectStore.getState();
    const segment = project.timeline.blurSegments.find(s => s.id === selectedBlurSegmentId);
    if (!segment) return;

    const regionId = selectedBlurRegionId ?? segment.regions[0]?.id;
    if (regionId) deleteBlurRegion(segment.id, regionId);

    const remaining = segment.regions.filter(r => r.id !== regionId);
    if (remaining.length > 0) selectBlurRegion(remaining[remaining.length - 1].id);
    else selectBlurSegment(null);
}
