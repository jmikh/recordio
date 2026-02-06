import { useState } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useTimeMapper } from '../../../hooks/useTimeMapper';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomAction } from '../../../../types';
import type { DragState } from './useZoomDrag';
import type { PreparedZoomAction } from './ZoomTrackUtils';

export interface HoverInfo {
    x: number;
    outputEndTime: number;
    width: number;
}

export function useZoomHover(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    dragState: DragState | null,
    editingZoomId: string | null,
    setEditingZoom: (id: string | null) => void,
    outputDuration: number,
    preparedActions: PreparedZoomAction[]
) {
    const addZoomAction = useProjectStore(s => s.addZoomAction);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const timeMapper = useTimeMapper();
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

    /**
     * Handles hover interactions for 'Add Zoom' ghost block.
     * Uses prepared actions (with computed output times) for collision detection.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        // No ghost when dragging or when something is selected
        if (dragState || editingZoomId || selectedSpotlightId) {
            setHoverInfo(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;

        // Convert x directly to output time
        let mouseOutputTimeMs = coords.xToMs(x);

        // Don't show hover if we're past the end of the output
        if (mouseOutputTimeMs > outputDuration) {
            setHoverInfo(null);
            return;
        }

        // Buffer zone in pixels for keyframe visual size (diamond/square is ~14px wide)
        const keyframeBufferPx = 10;
        const keyframeBufferMs = coords.xToMs(keyframeBufferPx);

        // 1. Check if we are inside an existing action OR near a keyframe marker
        const isInside = preparedActions.some((m: PreparedZoomAction) => {
            const start = m.outputStartTime;
            const end = m.outputEndTime;
            // Include buffer zone after keyframe end for the visual marker
            return mouseOutputTimeMs > start && mouseOutputTimeMs < (end + keyframeBufferMs);
        });

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // 2. Calculate Available Duration backwards (to the left)
        let prevEnd = 0;
        for (const m of preparedActions) {
            if (m.outputEndTime <= mouseOutputTimeMs) {
                if (m.outputEndTime > prevEnd) {
                    prevEnd = m.outputEndTime;
                }
            }
        }

        const defaultDur = project.settings.zoom.maxZoomDurationMs;
        const availableDuration = mouseOutputTimeMs - prevEnd;

        // Calculate width for display (duration is derived from available space)
        let displayDuration = Math.min(defaultDur, availableDuration);
        let outputEndTime = mouseOutputTimeMs;

        if (displayDuration < project.settings.zoom.minZoomDurationMs) {
            displayDuration = project.settings.zoom.minZoomDurationMs;
            outputEndTime = prevEnd + displayDuration;
        }

        // Calculate visual width and position
        const width = coords.msToX(displayDuration);
        const constrainedX = coords.msToX(outputEndTime);

        setHoverInfo({
            x: constrainedX,
            outputEndTime,
            width,
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        if (editingZoomId) {
            setEditingZoom(null);
            return;
        }

        if (!hoverInfo) return;

        // Convert output time to source time for storage
        const sourceEndTimeMs = timeMapper.mapOutputToSourceTime(hoverInfo.outputEndTime);
        if (sourceEndTimeMs === -1) return; // Invalid time

        // Find the closest previous action to inherit rect from
        const startTime = hoverInfo.outputEndTime - project.settings.zoom.maxZoomDurationMs;
        const previousAction = preparedActions
            .filter((m: PreparedZoomAction) => m.outputEndTime <= startTime)
            .sort((a: PreparedZoomAction, b: PreparedZoomAction) => b.outputEndTime - a.outputEndTime)[0];

        let initialRect;

        if (previousAction) {
            initialRect = { ...previousAction.rect };
        } else {
            // Default to 75% viewport centered
            const { width, height } = project.settings.outputSize;
            initialRect = {
                width: width * 0.75,
                height: height * 0.75,
                x: width * 0.125,
                y: height * 0.125
            };
        }

        const newAction: ZoomAction = {
            id: crypto.randomUUID(),
            sourceEndTimeMs,
            reason: 'Manual Zoom',
            rect: initialRect,
            type: 'manual'
        };

        addZoomAction(newAction);
        setEditingZoom(newAction.id);
        setHoverInfo(null);
    };

    return {
        hoverInfo,
        handleMouseMove,
        handleMouseLeave,
        handleClick
    };
}
