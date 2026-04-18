import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { useUIStore } from '../../../../stores/useUIStore';
import { TimePixelMapper } from '../../../../utils/timePixelMapper';
import type { SpotlightSegment } from '../../../../../types';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS, type TimelineSegmentDragState } from '../shared/useTimelineSegmentDrag';
import { getValidBlockRange, doSourceRangesOverlap } from '../shared/timelineTrackUtils';
import type { TimeMapper } from '../../../../../core/mappers/timeMapper';
import { getZoomBoundsForRange } from '../../../../../core/zoom/zoomBounds';
import { ViewMapper } from '../../../../../core/mappers/viewMapper';
import { getDeviceFrame } from '../../../../../core/deviceFrames';

export interface HoverInfo {
    x: number; // Left position in pixels
    outputStartTimeMs: number;
    outputEndTimeMs: number;
    width: number; // Width in pixels
}

export function useSpotlightHover(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    dragState: TimelineSegmentDragState | null,
    editingSpotlightId: string | null,
    setEditingSpotlight: (id: string | null) => void,
    outputDuration: number,
    spotlightSegments: SpotlightSegment[],
    timeMapper: TimeMapper
) {
    const addSpotlight = useProjectStore(s => s.addSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const hoverInfoSetAtRef = useRef<number>(0);

    // Clear ghost whenever a spotlight is selected (covers the case where the
    // mouse didn't move after selection, so handleMouseMove never cleared it).
    useEffect(() => {
        if (editingSpotlightId) setHoverInfo(null);
    }, [editingSpotlightId]);

    /**
     * Handles hover interactions for 'Add Spotlight' ghost block.
     * Ghost sizing is tiered based on available gap vs transition duration:
     *   1. Full block (in + hold + out = K_DEFAULT_TIMELINE_BLOCK_MS) if it fits
     *   2. Transitions only (in + out = transitionMs × 2) if hold doesn't fit
     *   3. Fill the gap proportionally if not even both transitions fit
     *   4. No ghost if gap < K_MIN_TIMELINE_BLOCK_MS
     * DISABLED while dragging or when any zoom/spotlight is selected.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState || editingSpotlightId || selectedZoomId || useUIStore.getState().highlightRange) {
            setHoverInfo(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const mouseTimeMs = coords.xToMs(x);

        if (mouseTimeMs > outputDuration || mouseTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        // Check if cursor is inside an existing spotlight
        const isInside = spotlightSegments.some(r =>
            mouseTimeMs >= r.outputStartTimeMs && mouseTimeMs <= r.outputEndTimeMs
        );
        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // Smart placement: starts near cursor, expands right; anchors left if near a boundary
        const range = getValidBlockRange(
            mouseTimeMs,
            spotlightSegments,
            outputDuration,
            K_MIN_TIMELINE_BLOCK_MS,
            K_DEFAULT_TIMELINE_BLOCK_MS
        );

        if (!range) {
            setHoverInfo(null);
            return;
        }

        // Only stamp when ghost first appears (null → non-null)
        if (!hoverInfo) {
            hoverInfoSetAtRef.current = Date.now();
        }
        setHoverInfo({
            x: coords.msToX(range.start),
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width: coords.msToX(range.end - range.start),
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        const currentSelectedSpotlightId = useUIStore.getState().selectedSpotlightId;
        if (currentSelectedSpotlightId) {
            setEditingSpotlight(null);
            setHoverInfo(null);
            return;
        }

        // Require the ghost to have been visible for at least 200ms (prevents
        // accidental adds from mouse-jitter between rapid deselect clicks)
        if (!hoverInfo || Date.now() - hoverInfoSetAtRef.current < 200) return;

        // Get source video size for the initial rect (spotlight is in source coordinates)
        const sourceSize = project.screenSource.size;

        if (!sourceSize || sourceSize.width === 0) {
            console.warn('[useSpotlightHover] No sourceSize found');
            return;
        }

        // Convert output placement times → source times
        const sourceStart = timeMapper.mapOutputToSourceTime(hoverInfo.outputStartTimeMs);
        const sourceEnd = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTimeMs);

        // Create initial rect — center within zoom bounds if available
        const { width, height } = sourceSize;
        const outputSize = project.settings.outputSize;
        const minSpotlightDim = Math.min(outputSize.width, outputSize.height) / 5;

        // Check if zoom bounds exist for this time range
        const zoomBounds = getZoomBoundsForRange(
            timeline.zoomSegments ?? [],
            hoverInfo.outputStartTimeMs,
            hoverInfo.outputEndTimeMs,
            outputSize,
            project.settings.zoom,
        );

        const zoomBoundsUsable = zoomBounds != null &&
            zoomBounds.width >= minSpotlightDim * 1.2 &&
            zoomBounds.height >= minSpotlightDim * 1.2;

        let initialSourceRect;

        if (zoomBoundsUsable && zoomBounds) {
            const deviceFrame = project.settings.screen.mode === 'device'
                ? getDeviceFrame(project.settings.screen.deviceFrameId)
                : undefined;

            // Convert zoom bounds (output coords) → source coords via ViewMapper
            const viewMapper = new ViewMapper(
                sourceSize,
                outputSize,
                project.settings.screen.padding,
                project.settings.screen.crop,
                project.screenSource.trackableContentRect,
                project.settings.screen.toolbar.enabled,
                deviceFrame
            );
            const contentRect = viewMapper.contentRect;

            // Inverse map: output → source
            const nx = (zoomBounds.x - contentRect.x) / contentRect.width;
            const ny = (zoomBounds.y - contentRect.y) / contentRect.height;
            const nw = zoomBounds.width / contentRect.width;
            const nh = zoomBounds.height / contentRect.height;

            const effectiveInputSize = project.settings.screen.crop
                ? { width: project.settings.screen.crop.width, height: project.settings.screen.crop.height }
                : sourceSize;
            const offsetX = project.settings.screen.crop?.x || 0;
            const offsetY = project.settings.screen.crop?.y || 0;

            const boundsInSource = {
                x: nx * effectiveInputSize.width + offsetX,
                y: ny * effectiveInputSize.height + offsetY,
                width: nw * effectiveInputSize.width,
                height: nh * effectiveInputSize.height,
            };

            // Center a 50%-of-bounds rect within the source bounds
            const rw = boundsInSource.width * 0.5;
            const rh = boundsInSource.height * 0.5;
            initialSourceRect = {
                width: rw,
                height: rh,
                x: boundsInSource.x + (boundsInSource.width - rw) / 2,
                y: boundsInSource.y + (boundsInSource.height - rh) / 2,
            };
        } else {
            // Fallback: center at 50% of source video
            initialSourceRect = {
                width: width * 0.5,
                height: height * 0.5,
                x: width * 0.25,
                y: height * 0.25,
            };
        }

        const newSpotlight: SpotlightSegment = {
            id: crypto.randomUUID(),
            sourceStartTimeMs: sourceStart,
            sourceEndTimeMs: sourceEnd,
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            visible: true,
            sourceRect: initialSourceRect,
            borderRadiusPx: [0, 0, 0, 0], // Start with sharp corners [tl, tr, br, bl]
            scale: project.settings.spotlight.enlargeScale,
            reason: 'Manual Spotlight',
            dimOpacity: project.settings.spotlight.dimOpacity,
            transitionDurationMs: project.settings.spotlight.transitionDurationMs,
            easing: project.settings.spotlight.easing,
        };

        // Delete any existing spotlights whose source range overlaps the new one
        const allSpotlights: SpotlightSegment[] = timeline.spotlightSegments || [];
        for (const existing of allSpotlights) {
            if (doSourceRangesOverlap(newSpotlight, existing)) {
                deleteSpotlight(existing.id);
            }
        }

        addSpotlight(newSpotlight);
        setEditingSpotlight(newSpotlight.id);
        setHoverInfo(null);
    };

    return {
        hoverInfo,
        handleMouseMove,
        handleMouseLeave,
        handleClick
    };
}
