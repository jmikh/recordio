import { useState } from 'react';
import { useProjectStore } from '../../../stores/useProjectStore';
import { TimePixelMapper } from '../../../utils/timePixelMapper';
import type { SpotlightAction, SpotlightSettings } from '../../../../core/types';
import type { DragState } from './useSpotlightDrag';
import { getValidSpotlightRange, getMinSpotlightDuration } from './SpotlightTrackUtils';

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
    dragState: DragState | null,
    editingSpotlightId: string | null,
    setEditingSpotlight: (id: string | null) => void,
    outputDuration: number
) {
    const addSpotlight = useProjectStore(s => s.addSpotlight);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

    const settings: SpotlightSettings = project.settings.spotlight;
    const minDuration = getMinSpotlightDuration(settings);

    /**
     * Handles hover interactions for 'Add Spotlight' ghost block.
     * DISABLED while dragging to prevent interference.
     */
    const handleMouseMove = (e: React.MouseEvent) => {
        if (dragState) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;

        const mouseTimeMs = coords.xToMs(x);

        // Don't show hover if we're past the end of the output
        if (mouseTimeMs > outputDuration || mouseTimeMs < 0) {
            setHoverInfo(null);
            return;
        }

        const spotlightActions = timeline.spotlightActions || [];

        // Check if we are inside an existing spotlight
        const isInside = spotlightActions.some((s: SpotlightAction) =>
            mouseTimeMs >= s.outputStartTimeMs && mouseTimeMs <= s.outputEndTimeMs
        );

        if (isInside) {
            setHoverInfo(null);
            return;
        }

        // Find valid range for new spotlight
        const range = getValidSpotlightRange(mouseTimeMs, spotlightActions, outputDuration, minDuration);

        if (!range) {
            setHoverInfo(null);
            return;
        }

        const width = coords.msToX(range.end - range.start);
        const leftX = coords.msToX(range.start);

        setHoverInfo({
            x: leftX,
            outputStartTimeMs: range.start,
            outputEndTimeMs: range.end,
            width,
        });
    };

    const handleMouseLeave = () => {
        if (!dragState) setHoverInfo(null);
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragState) return;

        if (editingSpotlightId) {
            setEditingSpotlight(null);
            return;
        }

        if (!hoverInfo) return;

        // Get source video size for the initial rect (spotlight is in source coordinates)
        const sourceSize = project.screenSource.size;

        if (!sourceSize || sourceSize.width === 0) {
            console.warn('[useSpotlightHover] No sourceSize found');
            return;
        }

        // Create initial rect centered at 50% of source video
        const { width, height } = sourceSize;
        const initialSourceRect = {
            width: width * 0.5,
            height: height * 0.5,
            x: width * 0.25,
            y: height * 0.25
        };

        const newSpotlight: SpotlightAction = {
            id: crypto.randomUUID(),
            outputStartTimeMs: hoverInfo.outputStartTimeMs,
            outputEndTimeMs: hoverInfo.outputEndTimeMs,
            sourceRect: initialSourceRect,
            borderRadius: [0, 0, 0, 0], // Start with sharp corners [tl, tr, br, bl]
            scale: project.settings.spotlight.enlargeScale,
            reason: 'Manual Spotlight'
        };

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
