import { useState } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { ZoomAction } from '../../../../core/types';
import type { DragState } from './useZoomDrag';
// Assuming Project and related types availability

export interface HoverInfo {
    x: number;
    outputEndTime: number;
    durationMs: number;
    width: number;
}

export function useZoomHover(
    timeline: any,
    project: any,
    coords: TimePixelMapper,
    dragState: DragState | null,
    editingZoomId: string | null,
    setEditingZoom: (id: string | null) => void,
    outputDuration: number
) {
    const addZoomAction = useProjectStore(s => s.addZoomAction);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

    /**
     * Handles hover interactions for 'Add Zoom' ghost block.
     * DISABLED while dragging to prevent interference/ghost blocks appearing during drag.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;

        // Convert x directly to output time
        let mouseOutputTimeMs = coords.xToMs(x);

        // Don't show hover if we're past the end of the output
        if (mouseOutputTimeMs > outputDuration) {
            setHoverInfo(null);
            return;
        }

        const actions = timeline.zoomActions || [];

        // 1. Check if we are inside an existing action
        const isInside = actions.some((m: ZoomAction) => {
            const start = m.outputEndTimeMs - m.durationMs;
            const end = m.outputEndTimeMs;
            return mouseOutputTimeMs > start && mouseOutputTimeMs < end;
        });

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // 2. Calculate Available Duration backwards (to the left)
        let prevEnd = 0;
        for (const m of actions) {
            if (m.outputEndTimeMs <= mouseOutputTimeMs) {
                if (m.outputEndTimeMs > prevEnd) {
                    prevEnd = m.outputEndTimeMs;
                }
            }
        }

        const defaultDur = project.settings.zoom.maxZoomDurationMs;
        const availableDuration = mouseOutputTimeMs - prevEnd;

        // Clamp duration
        let actualDuration = Math.min(defaultDur, availableDuration);
        let outputEndTime = mouseOutputTimeMs;

        if (actualDuration < project.settings.zoom.minZoomDurationMs) {
            actualDuration = project.settings.zoom.minZoomDurationMs;
            outputEndTime = prevEnd + actualDuration;
        }

        // Calculate visual width and position
        const width = coords.msToX(actualDuration);
        const constrainedX = coords.msToX(outputEndTime);

        setHoverInfo({
            x: constrainedX,
            durationMs: actualDuration,
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

        // Create Motion
        // Determine initial rect
        const startTime = hoverInfo.outputEndTime - hoverInfo.durationMs;
        const actions = timeline.zoomActions || [];

        // Find the closest previous motion
        // We look for a motion that ends at or before our start time
        // If multiple, we want the one that ends latest (closest to us)
        const previousAction = actions
            .filter((m: ZoomAction) => m.outputEndTimeMs <= startTime)
            .sort((a: ZoomAction, b: ZoomAction) => b.outputEndTimeMs - a.outputEndTimeMs)[0];

        let initialRect;

        if (previousAction) {
            initialRect = { ...previousAction.rect };
        } else {
            // Default to half viewport centered
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
            outputEndTimeMs: hoverInfo.outputEndTime,
            durationMs: hoverInfo.durationMs,
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
